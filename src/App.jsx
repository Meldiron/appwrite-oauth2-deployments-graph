import { useEffect, useState, useRef } from 'react'
import {
  login,
  logout,
  handleRedirect,
  getStoredToken,
  fetchProjectIds,
} from './lib/oidc'
import { fetchActivity } from './lib/activity'
import ContributionGraph from './components/ContributionGraph'

// phases: signin | authenticating | loading | done | error
export default function App() {
  const [phase, setPhase] = useState('signin')
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [data, setData] = useState(null) // { projectIds, perProject, events, verified }
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const isRedirect = window.location.pathname === '/redirect'
    const stored = getStoredToken()

    if (isRedirect) {
      runRedirect()
    } else if (stored) {
      runWithToken(stored)
    }
  }, [])

  async function runRedirect() {
    try {
      setPhase('authenticating')
      const tokens = await handleRedirect()
      // Drop the code/state from the URL bar.
      window.history.replaceState({}, '', '/')
      await runWithToken(tokens.access_token)
    } catch (e) {
      setError(e.message)
      setPhase('error')
    }
  }

  async function runWithToken(accessToken) {
    try {
      // 1. Resolve the accessible project IDs from the console endpoint.
      const projectIds = await fetchProjectIds(accessToken)

      if (projectIds.length === 0) {
        setData({ projectIds: [], perProject: [], events: [] })
        setPhase('done')
        return
      }

      // 2. Fetch deployment activity across all projects (max 10 at once).
      setProgress({ done: 0, total: projectIds.length })
      setPhase('loading')
      const { perProject, events } = await fetchActivity(
        projectIds,
        accessToken,
        (done, total) => setProgress({ done, total }),
      )

      setData({ projectIds, perProject, events })
      setPhase('done')
    } catch (e) {
      setError(e.message)
      setPhase('error')
    }
  }

  function signOut() {
    logout()
    setData(null)
    setError(null)
    setPhase('signin')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🦉</span>
          <span className="brand-name">
            Appwriting<span className="accent">Graph</span>
          </span>
        </div>
        {phase === 'done' && (
          <button className="ghost-btn" onClick={signOut}>
            Sign out
          </button>
        )}
      </header>

      <main className="main">
        {phase === 'signin' && <SignIn />}
        {phase === 'authenticating' && <Status text="Completing sign-in…" />}
        {phase === 'loading' && (
          <Status text={`Crunching deployments… ${progress.done}/${progress.total} projects`} />
        )}
        {phase === 'error' && <ErrorView message={error} onRetry={signOut} />}
        {phase === 'done' && data && <Dashboard data={data} />}
      </main>

      <footer className="footer">
        Built with Appwrite
      </footer>
    </div>
  )
}

function SignIn() {
  return (
    <div className="hero">
      <h1 className="hero-title">
        Turn your <span className="accent">deployments</span> into a graph.
      </h1>
      <p className="hero-sub">
        Sign in to visualize every function &amp; site deployment across your
        Appwrite projects — GitHub-contribution style.
      </p>
      <button className="cta" onClick={() => login()}>
        <AppwriteMark className="cta-logo" />
        Sign in with Appwrite
      </button>
    </div>
  )
}

// Official Appwrite logomark (https://appwrite.io/assets). Inherits the button's
// text color via `currentColor`.
function AppwriteMark({ className }) {
  return (
    <svg
      className={className}
      width="22"
      height="19"
      viewBox="0 0 112 98"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M111.1 73.4729V97.9638H48.8706C30.7406 97.9638 14.9105 88.114 6.44112 73.4729C5.2099 71.3444 4.13229 69.1113 3.22835 66.7935C1.45387 62.2516 0.338421 57.3779 0 52.2926V45.6712C0.0734729 44.5379 0.189248 43.4135 0.340647 42.3025C0.650124 40.0227 1.11768 37.7918 1.73218 35.6232C7.54544 15.0641 26.448 0 48.8706 0C71.2932 0 90.1935 15.0641 96.0068 35.6232H69.3985C65.0302 28.9216 57.4692 24.491 48.8706 24.491C40.272 24.491 32.711 28.9216 28.3427 35.6232C27.0113 37.6604 25.9782 39.9069 25.3014 42.3025C24.7002 44.4266 24.3796 46.6664 24.3796 48.9819C24.3796 56.0019 27.3319 62.3295 32.0653 66.7935C36.4515 70.9369 42.3649 73.4729 48.8706 73.4729H111.1Z"
        fill="currentColor"
      />
      <path
        d="M111.1 42.3027V66.7937H65.6759C70.4094 62.3297 73.3616 56.0021 73.3616 48.9821C73.3616 46.6666 73.041 44.4268 72.4399 42.3027H111.1Z"
        fill="currentColor"
      />
    </svg>
  )
}

function Status({ text }) {
  return (
    <div className="status">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  )
}

function ErrorView({ message, onRetry }) {
  return (
    <div className="status">
      <p className="error-title">Something went wrong 😅</p>
      <pre className="error-msg">{message}</pre>
      <button className="cta" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

function Dashboard({ data }) {
  const { projectIds, perProject, events } = data
  const totalFns = perProject.reduce((a, p) => a + (p.functions || 0), 0)
  const totalSites = perProject.reduce((a, p) => a + (p.sites || 0), 0)
  const withErrors = perProject.filter((p) => p.errors && p.errors.length)

  return (
    <div className="dashboard">
      <div className="stats">
        <Stat value={projectIds.length} label="Projects" />
        <Stat value={totalFns} label="Functions" />
        <Stat value={totalSites} label="Sites" />
        <Stat value={events.length} label="Deployments" />
      </div>

      <ContributionGraph events={events} />

      {withErrors.length > 0 && (
        <details className="errors">
          <summary>{withErrors.length} project(s) reported issues</summary>
          <ul>
            {withErrors.map((p) => (
              <li key={p.projectId}>
                <code>{p.projectId}</code>: {p.errors.join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
