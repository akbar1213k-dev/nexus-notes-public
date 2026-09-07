import * as dmpLib from 'diff-match-patch';

// Singleton diff-match-patch instance (stateless & aman untuk pemakaian ini)
const dmp = new dmpLib.diff_match_patch();

export type ReplaySource = {
  kind: 'base' | 'patch';
  content?: string;
  patchText?: string;
};

// Buat patch (selisih) dari before -> after.
// Mengembalikan string patch (kosong jika tidak ada perubahan).
export const makePatch = (before: string, after: string): string => {
  if (before === after) return '';
  const patches = dmp.patch_make(before, after);
  return dmp.patch_toText(patches);
};

// Terapkan patch ke baseText untuk merekonstruksi konten versi setelahnya.
export const applyPatch = (baseText: string, patchText: string): string => {
  try {
    const patches = dmp.patch_fromText(patchText);
    const [result] = dmp.patch_apply(patches, baseText);
    return result;
  } catch (e) {
    // Patch rusak/berabad zaman -> kembalikan apa adanya agar tidak merusak UI.
    console.error('Gagal menerapkan patch history:', e);
    return baseText;
  }
};

// Rekonstruksi konten dengan memutar rangkaian patch berurutan dari baseText.
export const applyPatchChain = (baseText: string, patches: string[]): string => {
  let text = baseText;
  for (const patchText of patches) {
    text = applyPatch(text, patchText);
  }
  return text;
};

// Replay seluruh rantai history (base[0] + patch seterusnya) menjadi daftar
// konten penuh per versi. Invariant: entries[0] harus berjenis 'base'.
export const replayChain = (entries: ReplaySource[]): string[] => {
  if (entries.length === 0) return [];
  const result: string[] = [];
  let text = entries[0].kind === 'base' ? (entries[0].content ?? '') : '';
  result.push(text);
  for (let i = 1; i < entries.length; i++) {
    text = applyPatch(text, entries[i].patchText ?? '');
    result.push(text);
  }
  return result;
};