### A Basic Deno Live Reload Dev Setup for Creating Web Frontends

No dependencies, no black box magic, just typescript.

All the magic is in `main.ts` which setup up the file watch and websockets to trigger your frontend to reload when files change. Uses the new deno bundle to bundle your `/src/main.ts` and imported files to browser friendly js.

### To Use
`deno task dev`

It should automatically reload your browser on any file changes within the `/src` directory.