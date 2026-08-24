# Playbook: Investigar un problema

Para cuando todavía no está claro si hay un bug, un problema de performance,
un problema de arquitectura, o simplemente falta de información — antes de
decidir qué proceso aplicar (bugfix, refactor, feature, etc.).

## Cuándo aplica

- "Algo anda raro pero no sé bien qué es."
- Un reporte vago sin pasos de reproducción ni causa evidente.
- Se sospecha un problema de arquitectura o de performance sin diagnóstico
  todavía.

## Proceso

1. **Recolectar toda la evidencia disponible** antes de teorizar: logs,
   métricas, reportes de usuarios, comportamiento observado. No saltar a una
   hipótesis con evidencia incompleta.
2. **Formular hipótesis explícitas** y, para cada una, definir qué evidencia
   la confirmaría o la refutaría.
3. **Verificar cada hipótesis** en orden de probabilidad/costo de
   verificación (empezar por la más barata de descartar).
4. **Aislar la causa** una vez identificada, con un caso mínimo reproducible.
5. **Clasificar el problema** una vez entendido: ¿es un bug (→
   [`fix-bug`](fix-bug.md)), un problema de arquitectura (→
   [`analyze-architecture`](technical-review.md)), o algo que requiere una
   feature nueva (→ [`add-feature`](add-feature.md))?

## Errores comunes

- Proponer un fix antes de confirmar la causa — "probemos esto a ver si
  arregla" sin entender por qué debería funcionar.
- Descartar una hipótesis sin haberla verificado realmente, solo por
  parecer poco probable.
- Investigar sin dejar registro de qué se probó y qué se descartó — quien
  retome la investigación (incluso vos mismo más tarde) repite el trabajo.
