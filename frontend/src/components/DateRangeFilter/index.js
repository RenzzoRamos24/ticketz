// PALAZ patch — filtro de período en la pestaña "Búsqueda" (Principio I,
// excepción cuarta; specs/000-despliegue-ticketz-vps/research.md
// R-068/R-073; docs/diseno-filtro-fecha-busqueda.md). Mismo patrón que
// TagsFilter/UsersFilter ya existentes: un callback `onFiltered` que
// recibe el criterio actual, sin estado propio fuera de este componente.
import { Box, TextField } from "@material-ui/core";
import React, { useState } from "react";
import { i18n } from "../../translate/i18n";

export function DateRangeFilter({ onFiltered }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Solo se filtra con el rango COMPLETO — un solo extremo no dice nada
  // (ver diseño, v1 acotada a rango cerrado). Mientras falte uno de los
  // dos, se limpia el filtro por completo en vez de mandar la mitad.
  const notify = (nextFrom, nextTo) => {
    if (nextFrom && nextTo) {
      onFiltered({ from: nextFrom, to: nextTo });
    } else {
      onFiltered(null);
    }
  };

  return (
    <Box style={{ padding: 10, display: "flex", gap: 8 }}>
      <TextField
        size="small"
        variant="outlined"
        type="date"
        label={i18n.t("tickets.search.filterByDateFrom")}
        InputLabelProps={{ shrink: true }}
        value={from}
        onChange={e => {
          setFrom(e.target.value);
          notify(e.target.value, to);
        }}
      />
      <TextField
        size="small"
        variant="outlined"
        type="date"
        label={i18n.t("tickets.search.filterByDateTo")}
        InputLabelProps={{ shrink: true }}
        value={to}
        // No tiene sentido pedir un "hasta" anterior al "desde" — el
        // propio input ya lo restringe, no hace falta validar aparte.
        inputProps={from ? { min: from } : {}}
        onChange={e => {
          setTo(e.target.value);
          notify(from, e.target.value);
        }}
      />
    </Box>
  );
}
