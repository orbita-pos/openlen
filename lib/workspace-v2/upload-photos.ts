/**
 * LAS FOTOS DEL ESTADO VACÍO, SUBIDAS (plans/crear-es-len).
 *
 * El compositor de la entrada las guarda como `data:` ya reducidas, y un
 * mensaje a Len viaja con DIRECCIONES (`attachedImages`): el modelo las ve y,
 * si van en la página, las coloca por su URL. Así que antes del primer mensaje
 * se suben por `POST /api/upload`, el mismo subidor que el inspector, y salen
 * en el mismo orden en que se adjuntaron.
 *
 * Una que no sube no tumba el mensaje: se cuenta en `failed` y quien llama lo
 * dice. Sin estado de React: se prueba con un `fetch` falso.
 */
export interface PhotoToUpload {
  readonly dataUrl: string;
  readonly nombre: string;
}

export interface UploadedPhotos {
  readonly images: { url: string }[];
  readonly failed: number;
}

export async function uploadPhotos(
  photos: readonly PhotoToUpload[],
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadedPhotos> {
  const results = await Promise.all(
    photos.map(async (photo): Promise<string | null> => {
      try {
        const blob = await (await fetchImpl(photo.dataUrl)).blob();
        const form = new FormData();
        form.append("file", new File([blob], photo.nombre || "foto", { type: blob.type || "image/jpeg" }));
        form.append("generationId", projectId);
        const res = await fetchImpl("/api/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
        return res.ok && typeof data?.url === "string" && data.url ? data.url : null;
      } catch {
        return null;
      }
    }),
  );
  const images = results.filter((url): url is string => url !== null).map((url) => ({ url }));
  return { images, failed: results.length - images.length };
}
