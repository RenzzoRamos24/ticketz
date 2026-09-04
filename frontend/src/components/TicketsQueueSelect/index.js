import React from "react";

import MenuItem from "@material-ui/core/MenuItem";
import FormControl from "@material-ui/core/FormControl";
import Select from "@material-ui/core/Select";
import { Checkbox, ListItemText } from "@material-ui/core";
import { i18n } from "../../translate/i18n";

// PALAZ patch — "Sin cola" como filtro seleccionable (Principio I,
// excepción cuarta; R-094; docs/propuesta-patch-006-filtro-sin-cola.md).
//
// Los id de cola son enteros positivos; 0 queda reservado como centinela
// de "sin cola". El backend (ListTicketsService) lo traduce a `queueId IS
// NULL`. NO es una cola real: no existe ninguna fila con ese id en Queues.
export const NO_QUEUE_SENTINEL = 0;

const TicketsQueueSelect = ({
  userQueues,
  selectedQueueIds = [],
  showNoQueueOption = false,
  onChange
}) => {
  const handleChange = e => {
    onChange(e.target.value);
  };

  return (
    <div style={{ width: 120, marginTop: -4 }}>
      <FormControl fullWidth margin="dense">
        <Select
          multiple
          displayEmpty
          variant="outlined"
          value={selectedQueueIds}
          onChange={handleChange}
          MenuProps={{
            anchorOrigin: {
              vertical: "bottom",
              horizontal: "left"
            },
            transformOrigin: {
              vertical: "top",
              horizontal: "left"
            },
            getContentAnchorEl: null
          }}
          renderValue={() => i18n.t("ticketsQueueSelect.placeholder")}
        >
          {/* PALAZ patch (excepción cuarta, R-094) — solo se ofrece a
              administradores: los asesores nunca vieron tickets sin cola y
              este filtro NO puede ampliarles lo que ven (condición b). */}
          {showNoQueueOption && (
            <MenuItem dense key="no-queue" value={NO_QUEUE_SENTINEL}>
              <Checkbox
                size="small"
                color="primary"
                checked={selectedQueueIds.indexOf(NO_QUEUE_SENTINEL) > -1}
              />
              <ListItemText primary={i18n.t("ticketsQueueSelect.noQueue")} />
            </MenuItem>
          )}
          {userQueues?.length > 0 &&
            userQueues.map(queue => (
              <MenuItem dense key={queue.id} value={queue.id}>
                <Checkbox
                  style={{
                    color: queue.color
                  }}
                  size="small"
                  color="primary"
                  checked={selectedQueueIds.indexOf(queue.id) > -1}
                />
                <ListItemText primary={queue.name} />
              </MenuItem>
            ))}
        </Select>
      </FormControl>
    </div>
  );
};

export default TicketsQueueSelect;
