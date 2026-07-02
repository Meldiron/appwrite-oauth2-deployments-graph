// Browser shim for `undici` — node-appwrite imports { Agent, FormData, File, fetch }
// from undici, but in the browser these are native globals. Agent is only used
// for self-signed TLS (server-only), so a no-op stand-in is fine.

export const fetch = (...args) => globalThis.fetch(...args)
export const FormData = globalThis.FormData
export const File = globalThis.File

export class Agent {
  constructor() {}
  destroy() {}
}

export default { fetch, FormData, File, Agent }
