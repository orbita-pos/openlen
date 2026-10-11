// LO QUE LA PÁGINA DEL PERFIL RECIBE DEL SERVIDOR (lib/profile/store.ts →
// `getProfile`), ya filtrado por quien mira. Sin fechas: todo es serializable.

export type ProfileRole = "dueno" | "editor" | "lector";

export interface ProfileProject {
  readonly id: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly deployUrl: string | null;
  /** El papel de la persona DEL PERFIL en el proyecto. */
  readonly role: ProfileRole;
  /** Quien mira también está en él (y no es la persona del perfil). */
  readonly shared: boolean;
  /** Quien mira puede abrirlo en el editor. */
  readonly canOpen: boolean;
  readonly updatedAt: string;
}

export interface ProfileData {
  readonly userId: string;
  readonly handle: string;
  readonly name: string | null;
  readonly bio: string | null;
  readonly avatar: string | null;
  /** Sólo en el tuyo: hay una foto subida (que se puede quitar). */
  readonly hasCustomAvatar: boolean;
  readonly links: readonly string[];
  /** Los fijados que quien mira puede ver, en el orden en que se fijaron. */
  readonly pinned: readonly ProfileProject[];
  /** Los demás (sin los fijados). */
  readonly projects: readonly ProfileProject[];
  /** «Trabajan juntos en N»: 0 en el tuyo y para un desconocido. */
  readonly sharedCount: number;
  readonly isSelf: boolean;
}
