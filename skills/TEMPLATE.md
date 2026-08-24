# Cómo crear una skill nueva en este repositorio

Toda skill vive en su propia carpeta bajo `skills/<nombre-en-kebab-case>/`,
con al menos un `SKILL.md`. Si necesita datos de referencia extensos
(esquemas, ejemplos largos, tablas), van en `skills/<nombre>/reference/`,
para no inflar el `SKILL.md` principal.

## Frontmatter obligatorio

```yaml
---
name: nombre-en-kebab-case
description: Una línea. Qué hace y CUÁNDO usarla — de esto depende que Claude la autodescubra correctamente.
---
```

La `description` es lo único que Claude ve antes de decidir si una skill
aplica a la conversación actual. Si es vaga ("ayuda con git"), la skill no se
va a activar cuando corresponde, o se va a activar cuando no corresponde.
Sé específico: qué dispara su uso, y opcionalmente qué la excluye.

## Estructura obligatoria del cuerpo

1. **Propósito** — una o dos frases: qué problema resuelve esta skill.
2. **Cuándo usarla** — señales concretas (palabras del usuario, situación del
   repo) que indican que esta skill aplica.
3. **Cuándo NO usarla** — casos límite donde parece aplicar pero no debería
   (evita falsos positivos, tan importante como el punto anterior).
4. **Pasos detallados** — el procedimiento, numerado, con decisiones
   explícitas donde haya bifurcaciones.
5. **Checklist** — lista corta y accionable para verificar antes de dar la
   tarea por completa.
6. **Ejemplos** — al menos uno concreto, con input/output o antes/después.
7. **Errores comunes** — qué suele salir mal al aplicar esta skill (por la
   propia experiencia, no hipotéticos).
8. **Buenas prácticas** — recomendaciones que no son pasos obligatorios pero
   mejoran el resultado.

## Reglas de estilo

- Sin archivos vacíos ni secciones "TODO". Si una sección no aplica, se omite,
  no se deja como placeholder.
- Preferí ejemplos reales por sobre descripciones abstractas.
- Si la skill necesita guardar estado (config, preferencias aprendidas), definí
  explícitamente dónde vive ese estado y por qué ahí — ver `ticket-workflow/SKILL.md`
  como referencia de una skill con estado persistente por repo.
- Si la skill puede chocar con una convención propia del repo de trabajo,
  decilo explícitamente: la convención del repo de trabajo gana siempre.

## Alta de la skill

Después de crear la carpeta y el `SKILL.md`, corré `./install.sh` desde la
raíz de este repositorio para que quede symlinkeada en `~/.claude/skills/` y
disponible en cualquier proyecto.
