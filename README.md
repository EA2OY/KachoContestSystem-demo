# 🎮 Kacho Contest System — DEMO (simulador)

**Simulador online del sistema**, sin servidor y sin hardware: es la **web real** del proyecto
funcionando en su *modo DEMO* (sincronización entre pestañas del mismo navegador mediante
BroadcastChannel). Ideal para probar la interfaz y enseñarla.

<p align="center">
  <a href="https://ea2oy.github.io/KachoContestSystem-demo/" target="_blank" rel="noopener">
    <strong>👉 Abrir la DEMO online (pestaña nueva) 🎮</strong>
  </a>
</p>

## 🚀 Cómo usarlo

1. Abre el enlace de arriba (o el de GitHub Pages de este repo).
2. Escribe el PIN **`134679`** y elige destino.
3. Abre **DOS pestañas del mismo navegador**:
   - Una con **Panel del super** (pestaña *Ajustes*).
   - Otra con **Pantalla de proyección** (o directamente `proyector.html`).
4. ¡Listo! Las dos pestañas se sincronizan entre sí: lanza preguntas, pulsa con los botones
   **Puls** de cada jugador, juzga con **Verdad/Falso**, prueba rebotes, modos **Puntos/Vidas**,
   el editor de layout, los sonidos (en la pestaña de proyección)…

> 💡 El modo DEMO se activa automáticamente en GitHub Pages (o con `?demo=1` en la URL).
> Incluye la **batería completa** de preguntas del sistema.

## ✏️ Es un sistema editable y persistente (por navegador)

En modo DEMO el sistema se comporta como el real y **guarda los cambios en tu navegador**
(localStorage), así que sobreviven a las recargas:

- **Preguntas**: añadir, editar, borrar, mover, marcar usadas (✓/↩), **▶ Siguiente**, pegar
  texto y **subir un `.txt`** (todo persistente).
- **Jugadores y configuración**: nombres, colores, puntos/vidas, modos, toggles…
- **Layout**: posiciones y tamaños del escenario.

Para **volver a la batería original**: borra los datos del sitio en tu navegador
(DevTools → Application → Clear site data) o pulsa "Vaciar batería" y recarga.

## ⚠️ Qué NO hace (es un simulador)

- No hay hardware: los pulsadores físicos, luces, OLED y LED RGB no existen aquí.
- No sincroniza **entre dispositivos** distintos (solo pestañas del mismo navegador).
- Las **subidas de MP3 e imágenes** de animación no funcionan (no hay servidor de archivos).

## 🧩 El proyecto real

Este demo es una copia de la carpeta `web/` del proyecto **Kacho Contest System** (firmware
ESP32-S3 + web para concursos de pulsadores, Navarra LAN Party). Repositorio principal:
privado. Manuales completos y guías de arquitectura, en ese repositorio.

## 📄 Licencia

MIT © 2026 Tai Soluciones — hecho con ❤️ por Kacho (EA2OY).
