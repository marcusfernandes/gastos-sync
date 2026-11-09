const LIMITE = 3000;

export async function lerRevisados(storage) {
  if (!storage.getConfig) return new Set();
  return new Set(JSON.parse((await storage.getConfig('revisados')) || '[]').map(String));
}

export async function marcarRevisados(storage, ids) {
  const atuais = [...(await lerRevisados(storage))];
  const novos = ids.map(String).filter((id) => !atuais.includes(id));
  await storage.setConfig('revisados', JSON.stringify([...atuais, ...novos].slice(-LIMITE)));
}
