import {
  Op,
  fn,
  where,
  col,
  literal,
  Filterable,
  Includeable,
  WhereOptions
} from "sequelize";
import { startOfDay, endOfDay, parseISO } from "date-fns";

import { intersection } from "lodash";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";
import Tag from "../../models/Tag";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import ContactTag from "../../models/ContactTag";

interface Request {
  isSearch?: boolean;
  searchParam?: string;
  nextUpdatedAt?: string;
  status?: string;
  groups?: string;
  date?: string;
  updatedAt?: string;
  minUpdatedAt?: string;
  messageDateFrom?: string;
  messageDateTo?: string;
  showAll?: string;
  userId: string;
  withUnreadMessages?: string;
  notClosed?: boolean;
  all?: boolean;
  queueIds: number[];
  contactId?: number;
  tags: number[];
  users: number[];
  companyId: number;
}

interface Response {
  tickets: Ticket[];
  count: number | null;
}

const ListTicketsService = async ({
  isSearch = false,
  searchParam = "",
  nextUpdatedAt,
  queueIds,
  contactId,
  tags,
  users,
  status,
  groups,
  date,
  updatedAt,
  minUpdatedAt,
  messageDateFrom,
  messageDateTo,
  showAll,
  userId,
  withUnreadMessages,
  notClosed,
  all,
  companyId
}: Request): Promise<Response> => {
  let ticketId: number;

  if (/^\d{8}-\d+$/.test(searchParam)) {
    const parts = searchParam.split("-");
    ticketId = parseInt(parts[1], 10);
  }

  if (Number(searchParam)) {
    ticketId = Number(searchParam);
  }

  if (ticketId) {
    searchParam = "";
  }

  if (
    (searchParam.trim().startsWith('"') && searchParam.trim().endsWith('"')) ||
    (searchParam.trim().startsWith("'") && searchParam.trim().endsWith("'"))
  ) {
    searchParam = searchParam.trim().slice(1, -1);
  }

  const groupsTab =
    !isSearch &&
    (await GetCompanySetting(companyId, "groupsTab", "disabled")) === "enabled";

  const user = await ShowUserService(userId);

  const andedOrs: WhereOptions<Ticket>[] = [
    {
      [Op.or]: [{ userId }, { status: "pending" }]
    }
  ];

  // PALAZ patch — bindings para el EXISTS del filtro de fecha, más abajo.
  // Sequelize los sustituye de forma segura (nunca interpolación de
  // string a mano) al pasarlos como `replacements` en Ticket.findAll().
  const replacements: Record<string, Date> = {};

  // PALAZ patch — "Sin cola" como filtro seleccionable (Principio I,
  // excepción cuarta; R-094; docs/propuesta-patch-006-filtro-sin-cola.md).
  //
  // Antes: si el perfil era admin, Ticketz añadía `null` al filtro SIEMPRE,
  // sin importar qué colas se hubieran seleccionado — los tickets sin cola
  // ("Sem fila") se colaban en toda vista filtrada. Con 78 de 89 tickets
  // pendientes sin cola en producción, eso ahogaba el resultado al filtrar
  // por la cola de un asesor concreto.
  //
  // Ahora los tickets sin cola se incluyen SOLO si el centinela viene en
  // `queueIds`, igual que cualquier otra cola. Se sigue restringiendo a
  // admin: los asesores nunca vieron tickets huérfanos y este parche NO
  // puede ampliarles lo que ven — condición (b) de la cuarta excepción.
  const NO_QUEUE_SENTINEL = 0;
  const canFilterNoQueue = user.profile === "admin";
  const noQueueSelected =
    canFilterNoQueue && (queueIds || []).includes(NO_QUEUE_SENTINEL);
  // El centinela nunca puede llegar a la consulta como si fuera un id real:
  // los id de cola son enteros positivos, 0 está reservado.
  const realQueueIds = (queueIds || []).filter(id => id !== NO_QUEUE_SENTINEL);

  let whereCondition: Filterable["where"] = {
    [Op.and]: andedOrs,
    queueId: {
      [Op.or]: noQueueSelected ? [realQueueIds, null] : [realQueueIds]
    }
  };

  if (groupsTab) {
    whereCondition.isGroup = groups === "true";
  }
  let includeCondition: Includeable[];

  includeCondition = [
    {
      model: Contact,
      as: "contact",
      include: ["tags", "extraInfo"],
      attributes: ["id", "name", "number", "email", "profilePicUrl", "presence"]
    },
    {
      model: Queue,
      as: "queue",
      attributes: ["id", "name", "color"]
    },
    {
      model: User,
      as: "user",
      attributes: ["id", "name"]
    },
    {
      model: Tag,
      as: "tags",
      attributes: ["id", "name", "color"]
    },
    {
      model: Whatsapp,
      as: "whatsapp",
      attributes: ["id", "name"]
    }
  ];

  if (showAll === "true" && user.profile === "admin") {
    andedOrs.length = 0;
    whereCondition = {
      [Op.and]: andedOrs,
      // PALAZ patch (excepción cuarta, R-094) — misma regla que arriba:
      // "sin cola" solo si el centinela fue seleccionado. Esta rama ya es
      // admin-only por la condición del `if`.
      queueId: {
        [Op.or]: noQueueSelected ? [realQueueIds, null] : [realQueueIds]
      }
    };
    if (groupsTab) {
      whereCondition.isGroup = groups === "true";
    }
  }

  if (status) {
    whereCondition = {
      ...whereCondition,
      status
    };
  }

  if (searchParam) {
    const sanitizedSearchParam = searchParam.toLocaleLowerCase().trim();

    includeCondition = [
      ...includeCondition,
      {
        model: Message,
        as: "messages",
        attributes: ["id", "body"],
        where: {
          body: where(
            fn("LOWER", col("body")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        required: false,
        duplicating: false
      }
    ];

    andedOrs.push({
      [Op.or]: [
        {
          "$contact.name$": where(
            fn("LOWER", col("contact.name")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        { "$contact.number$": { [Op.like]: `%${sanitizedSearchParam}%` } },
        {
          "$message.body$": where(
            fn("LOWER", col("body")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        }
      ]
    });
  }

  if (date) {
    whereCondition = {
      [Op.and]: andedOrs,
      createdAt: {
        [Op.between]: [+startOfDay(parseISO(date)), +endOfDay(parseISO(date))]
      }
    };
  }

  if (updatedAt) {
    whereCondition = {
      [Op.and]: andedOrs,
      updatedAt: {
        [Op.between]: [
          +startOfDay(parseISO(updatedAt)),
          +endOfDay(parseISO(updatedAt))
        ]
      }
    };
  }

  // PALAZ patch — filtro de período en la pestaña "Búsqueda" (Principio I,
  // excepción cuarta; specs/000-despliegue-ticketz-vps/research.md
  // R-068/R-073; docs/diseno-filtro-fecha-busqueda.md). NO hay campo
  // dedicado de "última actividad" en Ticket — updatedAt lo comparten
  // mensajes reales Y acciones administrativas (reasignar, cerrar, sin
  // relación con mensajes), verificado leyendo UpdateTicketService.ts y
  // wbotMessageListener.ts. El dato correcto es Message.createdAt.
  //
  // Deliberadamente NO se reutiliza el patrón de `date`/`updatedAt` de
  // arriba, que REEMPLAZAN whereCondition entero — eso descarta status y
  // queueId ya aplicados (R-062). Este filtro es ADITIVO sobre andedOrs,
  // mismo patrón que ya usan tags/users más abajo: nunca reemplaza nada,
  // solo agrega una condición más que se combina por AND con lo que ya
  // había — incluidas etiquetas, usuario y texto libre si están activos.
  //
  // EXISTS en vez de un segundo `include` de la asociación "messages":
  // searchParam ya usa esa asociación para el texto libre (más arriba);
  // Sequelize no admite dos `include` separados de la misma asociación
  // sin conflicto. El EXISTS es independiente, no toca includeCondition.
  if (messageDateFrom && messageDateTo) {
    replacements.messageDateFrom = startOfDay(parseISO(messageDateFrom));
    replacements.messageDateTo = endOfDay(parseISO(messageDateTo));

    andedOrs.push(
      literal(`EXISTS (
        SELECT 1 FROM "Messages" m
        WHERE m."ticketId" = "Ticket"."id"
          AND m."createdAt" BETWEEN :messageDateFrom AND :messageDateTo
      )`) as unknown as WhereOptions<Ticket>
    );
  }

  if (withUnreadMessages === "true") {
    whereCondition = {
      ...whereCondition,
      unreadMessages: { [Op.gt]: 0 }
    };
  }

  if (Array.isArray(tags) && tags.length > 0) {
    const ticketsTagFilter: number[][] = [];
    const contactsTagFilter: number[][] = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const tag of tags) {
      const ticketTags = await TicketTag.findAll({
        where: { tagId: tag }
      });
      if (ticketTags) {
        ticketsTagFilter.push(ticketTags.map(t => t.ticketId));
      }

      const contactTags = await ContactTag.findAll({
        where: { tagId: tag }
      });

      if (contactTags) {
        contactsTagFilter.push(contactTags.map(c => c.contactId));
      }
    }

    const ticketsIntersection: number[] = intersection(...ticketsTagFilter);
    const contactsIntersection: number[] = intersection(...contactsTagFilter);

    andedOrs.push({
      [Op.or]: [
        {
          id: { [Op.in]: ticketsIntersection }
        },
        {
          contactId: { [Op.in]: contactsIntersection }
        }
      ]
    });
  }

  if (contactId) {
    whereCondition = {
      ...whereCondition,
      contactId
    };
  }

  if (ticketId) {
    whereCondition = {
      ...whereCondition,
      id: ticketId
    };
  }

  if (Array.isArray(users) && users.length > 0) {
    const ticketsUserFilter: number[][] = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const u of users) {
      const ticketUsers = await Ticket.findAll({
        where: { userId: u }
      });
      if (ticketUsers) {
        ticketsUserFilter.push(ticketUsers.map(t => t.id));
      }
    }

    const ticketsIntersection: number[] = intersection(...ticketsUserFilter);

    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: ticketsIntersection
      }
    };
  }

  const limit = all ? undefined : 40;

  if (!all && nextUpdatedAt) {
    const parsedNextUpdatedAt = new Date(nextUpdatedAt);

    if (Number.isNaN(parsedNextUpdatedAt.getTime())) {
      throw new AppError("ERR_INVALID_NEXT_UPDATED_AT", 400);
    }

    andedOrs.push({
      updatedAt: { [Op.lt]: parsedNextUpdatedAt }
    });
  }

  if (minUpdatedAt) {
    const parsedMinUpdatedAt = new Date(minUpdatedAt);

    if (Number.isNaN(parsedMinUpdatedAt.getTime())) {
      throw new AppError("ERR_INVALID_MIN_UPDATED_AT", 400);
    }

    andedOrs.push({
      updatedAt: { [Op.gte]: parsedMinUpdatedAt }
    });
  }

  if (notClosed) {
    whereCondition = {
      ...whereCondition,
      status: { [Op.ne]: "closed" }
    };
  }

  whereCondition = {
    ...whereCondition,
    companyId
  };

  const tickets = await Ticket.findAll({
    where: whereCondition,
    include: includeCondition,
    limit,
    order: [
      ["updatedAt", "DESC"],
      ["id", "DESC"]
    ],
    subQuery: false,
    replacements
  });

  return {
    tickets,
    count: null
  };
};

export default ListTicketsService;
