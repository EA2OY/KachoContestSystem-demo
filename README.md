# 🎮 Kacho Contest System — DEMO (simulador)

**Simulador online del sistema**, sin servidor y sin hardware: es la **web real** del proyecto
funcionando en su *modo DEMO* (sincronización entre pestañas del mismo navegador mediante
BroadcastChannel). Ideal para probar la interfaz y enseñarla.

## 🚀 Cómo usarlo

1. Abre esta página (el enlace de GitHub Pages de este repo).
2. Escribe el PIN **`134679`** y elige destino.
3. Abre **DOS pestañas del mismo navegador**:
   - Una con **Panel del super** (pestaña *Ajustes*).
   - Otra con **Pantalla de proyección** (o directamente `proyector.html`).
4. ¡Listo! Las dos pestañas se sincronizan entre sí: lanza preguntas, pulsa con los botones
   **Puls** de cada jugador, juzga con **Verdad/Falso**, prueba rebotes, modos **Puntos/Vidas**,
   el editor de layout, los sonidos (en la pestaña de proyección)…

> 💡 El modo DEMO se activa automáticamente en GitHub Pages (o con `?demo=1` en la URL).
> La batería de preguntas incluida es **una muestra** (12 preguntas de ejemplo).

## ⚠️ Qué NO hace (es un simulador)

- No hay hardware: los pulsadores físicos, luces, OLED y LED RGB no existen aquí.
- No sincroniza **entre dispositivos** distintos (solo pestañas del mismo navegador).
- Las subidas (MP3, imágenes) y la edición de la batería no se guardan de forma permanente.

## 🧩 El proyecto real

Este demo es una copia de la carpeta `web/` del proyecto **Kacho Contest System** (firmware
ESP32-S3 + web para concursos de pulsadores, Navarra LAN Party). Repositorio principal:
privado. Manuales completos y guías de arquitectura, en ese repositorio.

## 📄 Licencia

MIT © 2026 Tai Soluciones — hecho con ❤️ por Kacho (EA2OY).
