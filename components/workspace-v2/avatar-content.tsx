// LO QUE VA DENTRO DE LA BURBUJA DE UNA PERSONA (el chat, la gente, los
// miembros, los hilos): su foto si tiene, y si no, la inicial de siempre. La
// burbuja la pone quien llama —su tamaño y su color no cambian—; esto sólo
// decide qué va dentro. Qué foto es la de cada uno lo decide el servidor
// (`avatarOf`, lib/profile/avatar.ts). La burbuja necesita `overflow-hidden`.
export function AvatarContent({ avatar, initial }: { avatar?: string | null; initial: string }) {
  if (!avatar) return <>{initial}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />;
}
