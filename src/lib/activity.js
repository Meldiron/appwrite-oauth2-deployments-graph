// Fetches deployment activity across all granted projects using the
// node-appwrite SDK, authenticating with the OAuth2 access token.

import { Client, Functions, Sites, Query } from 'node-appwrite'

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1'
const PAGE = 100
const MAX_CONCURRENCY = 10
// Only look back a little over a year — that's all the contribution graph shows.
const LOOKBACK_DAYS = 371

function cutoffISO() {
  const d = new Date()
  d.setDate(d.getDate() - LOOKBACK_DAYS)
  return d.toISOString()
}

// Build an admin-mode client bound to a single project, authorized via the
// OAuth2 access token.
function makeClient(projectId, accessToken) {
  const client = new Client().setEndpoint(ENDPOINT).setProject(projectId)
  client.addHeader('X-Appwrite-Mode', 'admin')
  client.addHeader('Authorization', `Bearer ${accessToken}`)
  return client
}

// Run `fn` over `items` with a bounded number of concurrent executions.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx], idx)
    }
  }
  const size = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: size }, worker))
  return results
}

// Generic cursor pagination. `call({ queries })` returns a response object;
// `pick` extracts the array of items from it.
async function paginate(call, pick, extraQueries = []) {
  const cutoff = cutoffISO()
  const items = []
  let cursor = null
  for (;;) {
    const queries = [
      Query.limit(PAGE),
      Query.orderDesc('$createdAt'),
      ...extraQueries,
    ]
    if (cursor) queries.push(Query.cursorAfter(cursor))
    const res = await call({ queries })
    const batch = pick(res) || []
    items.push(...batch)
    if (batch.length < PAGE) break
    const last = batch[batch.length - 1]
    // Stop early once we've paged past the lookback window.
    if (last.$createdAt && last.$createdAt < cutoff) break
    cursor = last.$id
  }
  return items
}

// Collect deployment $createdAt events for one project.
async function fetchProject(projectId, accessToken) {
  const client = makeClient(projectId, accessToken)
  const functions = new Functions(client)
  const sites = new Sites(client)
  const cutoff = cutoffISO()
  const events = []
  const result = {
    projectId,
    functions: 0,
    sites: 0,
    deployments: 0,
    errors: [],
  }

  // Functions + their deployments.
  try {
    const fns = await paginate(
      (opts) => functions.list(opts),
      (r) => r.functions,
    )
    result.functions = fns.length
    await mapLimit(fns, MAX_CONCURRENCY, async (fn) => {
      try {
        const deps = await paginate(
          (opts) => functions.listDeployments({ functionId: fn.$id, ...opts }),
          (r) => r.deployments,
          [Query.greaterThanEqual('$createdAt', cutoff)],
        )
        for (const d of deps) {
          events.push({ date: d.$createdAt, kind: 'function', projectId, resourceId: fn.$id })
        }
      } catch (e) {
        result.errors.push(`function ${fn.$id}: ${e.message}`)
      }
    })
  } catch (e) {
    result.errors.push(`functions.list: ${e.message}`)
  }

  // Sites + their deployments.
  try {
    const sts = await paginate(
      (opts) => sites.list(opts),
      (r) => r.sites,
    )
    result.sites = sts.length
    await mapLimit(sts, MAX_CONCURRENCY, async (site) => {
      try {
        const deps = await paginate(
          (opts) => sites.listDeployments({ siteId: site.$id, ...opts }),
          (r) => r.deployments,
          [Query.greaterThanEqual('$createdAt', cutoff)],
        )
        for (const d of deps) {
          events.push({ date: d.$createdAt, kind: 'site', projectId, resourceId: site.$id })
        }
      } catch (e) {
        result.errors.push(`site ${site.$id}: ${e.message}`)
      }
    })
  } catch (e) {
    result.errors.push(`sites.list: ${e.message}`)
  }

  result.deployments = events.length
  result.events = events
  return result
}

// Fetch activity across all project IDs, max 10 projects in flight at once.
export async function fetchActivity(projectIds, accessToken, onProgress) {
  let done = 0
  const perProject = await mapLimit(projectIds, MAX_CONCURRENCY, async (id) => {
    let res
    try {
      res = await fetchProject(id, accessToken)
    } catch (e) {
      res = { projectId: id, functions: 0, sites: 0, deployments: 0, events: [], errors: [e.message] }
    }
    done++
    onProgress?.(done, projectIds.length)
    return res
  })

  const events = perProject.flatMap((p) => p.events || [])
  return { perProject, events }
}
