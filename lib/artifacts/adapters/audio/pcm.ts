import { ArtifactError } from "../../types";
export function pcmToWav(pcm:Uint8Array):{wav:Uint8Array;durationSeconds:number}{
  if(!(pcm instanceof Uint8Array)||pcm.length<2||pcm.length%2||pcm.length>5_760_000)throw new ArtifactError("audio_pcm_invalid");
  const wav=Buffer.alloc(44+pcm.length);
  wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(pcm.length,40);wav.set(pcm,44);
  return {wav,durationSeconds:pcm.length/48000};
}
