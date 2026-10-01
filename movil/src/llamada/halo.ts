// El halo de la cara late con la voz REAL de Len: el volumen de la pista que
// llega por WebRTC, medido con un AnalyserNode (forma de onda, 128 = silencio).
export function nivelDeVoz(datos: Uint8Array): number {
  if (datos.length === 0) return 0;
  let s = 0;
  for (const v of datos) {
    const x = (v - 128) / 128;
    s += x * x;
  }
  return Math.min(1, Math.sqrt(s / datos.length) * 1.4);
}

/** Engancha un analizador a la voz de Len y llama a `alNivel` en cada cuadro. Devuelve cómo pararlo. */
export function escucharNivel(voz: MediaStream, alNivel: (n: number) => void): () => void {
  const ctx = new AudioContext();
  const fuente = ctx.createMediaStreamSource(voz);
  const an = ctx.createAnalyser();
  an.fftSize = 256;
  fuente.connect(an);
  const datos = new Uint8Array(an.fftSize);
  let vivo = true;
  const cuadro = () => {
    if (!vivo) return;
    an.getByteTimeDomainData(datos);
    alNivel(nivelDeVoz(datos));
    requestAnimationFrame(cuadro);
  };
  cuadro();
  return () => {
    vivo = false;
    void ctx.close();
  };
}
