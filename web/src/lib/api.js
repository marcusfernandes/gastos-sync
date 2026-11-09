export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) dispatchEvent(new Event('sessao-expirada'));
  if (!res.ok) throw Object.assign(new Error(data.erro || res.statusText), { data, status: res.status });
  return data;
}
