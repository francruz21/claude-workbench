# Templates

Plantillas reutilizables para artefactos que se repiten entre proyectos. Cada
una incluye una breve instrucción de uso al principio y placeholders entre
`{{ }}` para completar.

## Índice

- [`pull-request.md`](pull-request.md) — descripción de PR.
- [`commit-message.md`](commit-message.md) — formato de mensaje de commit (Conventional Commits).
- [`adr.md`](adr.md) — Architecture Decision Record.
- [`rfc.md`](rfc.md) — Request for Comments, para decisiones que necesitan discusión previa amplia.
- [`bug-report.md`](bug-report.md) — reporte de bug estructurado.
- [`technical-design.md`](technical-design.md) — diseño técnico de una feature.
- [`feature-proposal.md`](feature-proposal.md) — propuesta de feature antes de aprobar el diseño.

## ADR vs RFC vs Technical Design — cuándo usar cada uno

- **ADR**: documenta una decisión ya tomada, para que quede registro del por
  qué (corto, va al repo, no busca consenso previo).
- **RFC**: propone una decisión **antes** de tomarla, buscando feedback de
  otros antes de comprometerse (más largo, circula para comentarios).
- **Technical Design**: el "cómo" detallado de una feature ya aprobada en su
  RFC/ADR, o de una feature acotada que no necesitó ninguno de los dos.

Ver [`examples/`](../examples/) para ejemplos completos rellenos.
