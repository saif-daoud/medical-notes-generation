import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  Cloud,
  Download,
  FileText,
  GraduationCap,
  KeyRound,
  Languages,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  Scale,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiEnabled, postJSON } from "./api.js";
import { OutputViewer, TextModal } from "./renderers.jsx";
import { STORAGE_KEYS, clearStudyStorage, loadJson, saveJson } from "./storage.js";
import { downloadJson, makeParticipantId, makeSequence, nowUtc, sha256Hex } from "./utils.js";

const DEFAULT_ACCESS_CODE_HASH = "a7f5fbabd1624ba763ed037a9b3ed7289cda4e739b06be222f6d3589cdba8a87";
const ACCESS_CODE_HASH = String(import.meta.env.VITE_ACCESS_CODE_HASH || DEFAULT_ACCESS_CODE_HASH).trim().toLowerCase();

const ROUTES = {
  access: "access",
  welcome: "welcome",
  review: "review",
  stats: "stats",
};

const CHOICE_LABELS = {
  left: "Option 1",
  tie: "Tie",
  right: "Option 2",
};

function routeFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return Object.values(ROUTES).includes(hash) ? hash : ROUTES.access;
}

function go(route) {
  window.location.hash = `/${route}`;
}

function upsertResponse(responses, response) {
  const next = responses.filter((item) => item.comparison_id !== response.comparison_id);
  next.push(response);
  return next.sort((a, b) => Number(a.sequence_index || 0) - Number(b.sequence_index || 0));
}

function responseId(participantId, comparisonId) {
  return `resp_${participantId}_${comparisonId}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
}

function byId(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function verifyLocalAccessCode(accessCode) {
  if (!String(accessCode || "").trim()) throw new Error("Please enter the access code.");
  const hash = await sha256Hex(String(accessCode || "").trim());
  if (hash !== ACCESS_CODE_HASH) throw new Error("Invalid access code.");
}

function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [study, setStudy] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [accounts, setAccounts] = useState(() => loadJson(STORAGE_KEYS.accounts, {}));
  const [profile, setProfile] = useState(null);
  const [responses, setResponses] = useState([]);
  const [sequence, setSequence] = useState([]);
  const [activeComparisonId, setActiveComparisonId] = useState("");
  const [remoteStats, setRemoteStats] = useState(null);
  const [remoteStatus, setRemoteStatus] = useState(apiEnabled() ? "Cloudflare sync configured" : "Local prototype");

  useEffect(() => {
    document.title = "Sakina SOAP Review";
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/study-data.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load study data.");
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setStudy(payload);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error?.message || "Could not load study data.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveJson(STORAGE_KEYS.accounts, accounts);
  }, [accounts]);

  useEffect(() => {
    if (profile) saveJson(STORAGE_KEYS.profile, profile);
  }, [profile]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.responses, responses);
  }, [responses]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.sequence, sequence);
  }, [sequence]);

  useEffect(() => {
    if (!profile || !study) return;
    if (!Array.isArray(sequence) || sequence.length !== study.comparisonCount) {
      setSequence(makeSequence(study.comparisons, profile.email || profile.participant_id));
    }
  }, [profile, sequence, study]);

  useEffect(() => {
    if (!profile || apiEnabled()) return;
    const email = normalizeEmail(profile.email);
    if (!email) return;
    setAccounts((current) => ({
      ...current,
      [email]: {
        profile,
        responses,
        sequence,
        updated_at_utc: nowUtc(),
      },
    }));
  }, [profile, responses, sequence]);

  useEffect(() => {
    if (!profile && route !== ROUTES.access) go(ROUTES.access);
    if (profile && route === ROUTES.access) go(ROUTES.welcome);
  }, [profile, route]);

  const outputMap = useMemo(() => byId(study?.outputs), [study]);
  const responseMap = useMemo(() => new Map(responses.map((response) => [response.comparison_id, response])), [responses]);
  const answeredCount = responses.length;
  const totalCount = study?.comparisonCount || 0;
  const firstUnanswered = useMemo(
    () => sequence.find((item) => !responseMap.has(item.comparisonId)) || null,
    [responseMap, sequence],
  );
  const activeItem = useMemo(() => {
    if (!sequence.length) return null;
    return sequence.find((item) => item.comparisonId === activeComparisonId) || firstUnanswered || sequence[0];
  }, [activeComparisonId, firstUnanswered, sequence]);

  useEffect(() => {
    if (!activeComparisonId && firstUnanswered) setActiveComparisonId(firstUnanswered.comparisonId);
  }, [activeComparisonId, firstUnanswered]);

  async function refreshRemoteStats() {
    if (!apiEnabled()) return;
    try {
      const payload = await postJSON("/api/stats", {});
      setRemoteStats(payload?.stats || null);
      setRemoteStatus("Cloudflare stats loaded");
    } catch (error) {
      setRemoteStatus(`Cloudflare stats unavailable: ${error?.message || "request failed"}`);
    }
  }

  async function handleAccessSubmit({ email, accessCode }) {
    const normalizedEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Please enter a valid email address.");

    if (apiEnabled()) {
      const result = await postJSON("/api/access", { email: normalizedEmail, access_code: accessCode });
      if (result?.token) localStorage.setItem(STORAGE_KEYS.token, String(result.token || ""));

      if (result?.profile_complete && result?.profile) {
        const nextProfile = {
          ...result.profile,
          email: normalizedEmail,
          participant_id: String(result.participant_id || result.profile.participant_id || makeParticipantId(normalizedEmail)),
        };
        setProfile(nextProfile);
        setRemoteStatus("Cloudflare session ready");

        try {
          const history = await postJSON("/api/history", { token: result.token });
          setResponses(Array.isArray(history?.responses) ? history.responses : []);
        } catch {
          setResponses([]);
          setRemoteStatus("Cloudflare session ready; history will retry after the first save");
        }

        setSequence(study ? makeSequence(study.comparisons, normalizedEmail) : []);
        go(ROUTES.welcome);
        return { existing: true };
      }

      return { existing: false, email: normalizedEmail };
    }

    await verifyLocalAccessCode(accessCode);
    const account = accounts[normalizedEmail];
    if (account?.profile) {
      const nextProfile = {
        ...account.profile,
        email: normalizedEmail,
        participant_id: account.profile.participant_id || makeParticipantId(normalizedEmail),
      };
      setProfile(nextProfile);
      setResponses(Array.isArray(account.responses) ? account.responses : []);
      setSequence(
        Array.isArray(account.sequence) && account.sequence.length === study.comparisonCount
          ? account.sequence
          : makeSequence(study.comparisons, normalizedEmail),
      );
      go(ROUTES.welcome);
      return { existing: true };
    }

    return { existing: false, email: normalizedEmail };
  }

  async function handleProfileSubmit(nextProfile) {
    const accessCode = String(nextProfile.access_code || "").trim();
    const normalized = {
      ...nextProfile,
      email: normalizeEmail(nextProfile.email),
      name: nextProfile.name.trim(),
      role: nextProfile.role.trim(),
      institution: nextProfile.institution.trim(),
      latest_degree: nextProfile.latest_degree.trim(),
      years_experience: Number(nextProfile.years_experience),
      participant_id: makeParticipantId(nextProfile.email),
      started_at_utc: nowUtc(),
    };
    delete normalized.access_code;

    if (apiEnabled()) {
      const result = await postJSON("/api/session", { profile: normalized, access_code: accessCode });
      localStorage.setItem(STORAGE_KEYS.token, String(result.token || ""));
      normalized.participant_id = String(result.participant_id || normalized.participant_id);
      setRemoteStatus("Cloudflare session ready");

      try {
        const history = await postJSON("/api/history", { token: result.token });
        if (Array.isArray(history?.responses)) setResponses(history.responses);
      } catch {
        setRemoteStatus("Cloudflare session ready; history will retry after the first save");
      }
    } else {
      await verifyLocalAccessCode(accessCode);
    }

    setProfile(normalized);
    setSequence(study ? makeSequence(study.comparisons, normalized.email) : []);
    go(ROUTES.welcome);
  }

  function logout() {
    clearStudyStorage();
    setProfile(null);
    setResponses([]);
    setSequence([]);
    setActiveComparisonId("");
    setRemoteStats(null);
    go(ROUTES.access);
  }

  async function saveResponse(response) {
    const optimistic = apiEnabled() ? { ...response, synced: false } : { ...response, synced: null };
    setResponses((current) => upsertResponse(current, optimistic));

    if (apiEnabled()) {
      try {
        const token = localStorage.getItem(STORAGE_KEYS.token);
        await postJSON("/api/response", { token, response });
        setResponses((current) => upsertResponse(current, { ...response, synced: true, synced_at_utc: nowUtc() }));
        setRemoteStatus("Saved to Cloudflare");
      } catch (error) {
        setResponses((current) => upsertResponse(current, { ...response, synced: false, sync_error: error?.message || "Upload failed" }));
        setRemoteStatus(`Saved locally; Cloudflare sync pending: ${error?.message || "request failed"}`);
      }
    }

    const next = sequence.find((item) => item.comparisonId !== response.comparison_id && !responseMap.has(item.comparisonId));
    if (next) setActiveComparisonId(next.comparisonId);
  }

  if (loadError) {
    return (
      <main className="centerShell">
        <section className="accessPanel">
          <div className="eyebrow danger">Data error</div>
          <h1>Study data did not load</h1>
          <p>{loadError}</p>
        </section>
      </main>
    );
  }

  if (!study) {
    return (
      <main className="centerShell">
        <section className="accessPanel">
          <div className="eyebrow">Loading</div>
          <h1>Sakina SOAP Review</h1>
          <p>Preparing the anonymized comparison set.</p>
        </section>
      </main>
    );
  }

  if (!profile || route === ROUTES.access) {
    return <AccessPage cloudMode={apiEnabled()} onAccess={handleAccessSubmit} onSubmit={handleProfileSubmit} />;
  }

  return (
    <AppShell
      profile={profile}
      route={route}
      answeredCount={answeredCount}
      totalCount={totalCount}
      remoteStatus={remoteStatus}
      onLogout={logout}
    >
      {route === ROUTES.welcome && <WelcomePage study={study} onStart={() => go(ROUTES.review)} />}
      {route === ROUTES.review && (
        <ReviewPage
          study={study}
          profile={profile}
          outputMap={outputMap}
          sequence={sequence}
          activeItem={activeItem}
          activeComparisonId={activeComparisonId}
          setActiveComparisonId={setActiveComparisonId}
          responses={responses}
          responseMap={responseMap}
          onSave={saveResponse}
        />
      )}
      {route === ROUTES.stats && (
        <StatsPage
          study={study}
          profile={profile}
          sequence={sequence}
          responses={responses}
          responseMap={responseMap}
          remoteStats={remoteStats}
          onRefreshRemoteStats={refreshRemoteStats}
        />
      )}
    </AppShell>
  );
}

function AppShell({ profile, route, answeredCount, totalCount, remoteStatus, onLogout, children }) {
  const progress = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <div className="brandTitle">Sakina SOAP Review</div>
            <div className="brandSub">{profile.name} · {profile.participant_id}</div>
          </div>
        </div>

        <div className="topbarCenter">
          <div className="progressMeta">
            <span>{answeredCount}/{totalCount} comparisons</span>
            <span>{progress}%</span>
          </div>
          <div className="progressTrack" aria-hidden="true">
            <div className="progressFill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <nav className="topbarActions" aria-label="Primary">
          <button className={route === ROUTES.welcome ? "navButton active" : "navButton"} type="button" onClick={() => go(ROUTES.welcome)}>
            <FileText size={17} />
            Welcome
          </button>
          <button className={route === ROUTES.review ? "navButton active" : "navButton"} type="button" onClick={() => go(ROUTES.review)}>
            <CheckCircle2 size={17} />
            Review
          </button>
          <button className={route === ROUTES.stats ? "navButton active" : "navButton"} type="button" onClick={() => go(ROUTES.stats)}>
            <BarChart3 size={17} />
            Stats
          </button>
          <button className="navButton" type="button" onClick={onLogout}>
            <LogOut size={17} />
            Exit
          </button>
        </nav>
      </header>

      <div className="syncStrip">
        <Cloud size={16} />
        <span>{remoteStatus}</span>
      </div>

      {children}
    </div>
  );
}

function AccessPage({ cloudMode, onAccess, onSubmit }) {
  const [step, setStep] = useState("gate");
  const [gate, setGate] = useState({
    email: "",
    access_code: "",
  });
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    access_code: "",
    role: "",
    institution: "",
    latest_degree: "",
    years_experience: "",
  });
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  function updateGate(field, value) {
    setGate((current) => ({ ...current, [field]: value }));
  }

  async function submitGate(event) {
    event.preventDefault();
    setStatus("");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gate.email.trim())) return setStatus("Please enter a valid email address.");
    if (!gate.access_code.trim()) return setStatus("Please enter the access code.");

    try {
      setSubmitting(true);
      setStatus(cloudMode ? "Checking access..." : "Checking access code...");
      const result = await onAccess({ email: gate.email, accessCode: gate.access_code });
      if (!result?.existing) {
        setProfile((current) => ({
          ...current,
          email: result?.email || gate.email.trim().toLowerCase(),
          access_code: gate.access_code,
        }));
        setStep("profile");
        setStatus("Access code accepted. Please complete your participant details.");
      }
    } catch (error) {
      setStatus(error?.message || "Could not verify access.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitProfile(event) {
    event.preventDefault();
    setStatus("");

    if (!profile.name.trim()) return setStatus("Please enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) return setStatus("Please enter a valid email address.");
    if (!profile.access_code.trim()) return setStatus("Please enter the access code.");
    if (!profile.role.trim()) return setStatus("Please enter your role or clinical specialty.");
    if (!profile.institution.trim()) return setStatus("Please enter your institution.");
    if (!profile.latest_degree.trim()) return setStatus("Please enter your latest degree.");

    const years = Number(profile.years_experience);
    if (!Number.isFinite(years) || years < 0 || years > 80) return setStatus("Please enter valid years of experience.");

    try {
      setSubmitting(true);
      setStatus(cloudMode ? "Opening Cloudflare session..." : "Opening local review session...");
      await onSubmit(profile);
    } catch (error) {
      setStatus(error?.message || "Could not start the session.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="centerShell accessShell">
      <section className="accessPanel">
        <div className="eyebrow">
          <LockKeyhole size={14} />
          Expert access
        </div>
        <h1>Sakina SOAP Review</h1>
        <p>
          Enter your email and access code. Returning experts will resume immediately; new experts will complete a short profile first.
        </p>

        {step === "gate" ? (
          <form className="accessForm accessFormGate" onSubmit={submitGate}>
            <Input icon={<Mail size={18} />} label="Email" type="email" value={gate.email} onChange={(value) => updateGate("email", value)} autoComplete="email" />
            <Input icon={<KeyRound size={18} />} label="Access code" type="password" value={gate.access_code} onChange={(value) => updateGate("access_code", value)} autoComplete="one-time-code" />

            <button className="primaryAction" type="submit" disabled={submitting}>
              {submitting ? <RefreshCw size={18} className="spin" /> : <ArrowRight size={18} />}
              {submitting ? "Checking..." : "Continue"}
            </button>
          </form>
        ) : (
          <form className="accessForm" onSubmit={submitProfile}>
            <Input icon={<Mail size={18} />} label="Email" type="email" value={profile.email} onChange={(value) => update("email", value)} autoComplete="email" />
            <Input icon={<KeyRound size={18} />} label="Access code" type="password" value={profile.access_code} onChange={(value) => update("access_code", value)} autoComplete="one-time-code" />
            <Input icon={<UserRound size={18} />} label="Full name" value={profile.name} onChange={(value) => update("name", value)} autoComplete="name" />
            <Input icon={<BriefcaseBusiness size={18} />} label="Role or specialty" value={profile.role} onChange={(value) => update("role", value)} />
            <Input icon={<Building2 size={18} />} label="Institution" value={profile.institution} onChange={(value) => update("institution", value)} />
            <Input icon={<GraduationCap size={18} />} label="Latest degree" value={profile.latest_degree} onChange={(value) => update("latest_degree", value)} />
            <Input icon={<BarChart3 size={18} />} label="Years of experience" type="number" min="0" max="80" value={profile.years_experience} onChange={(value) => update("years_experience", value)} />

            <div className="formActions">
              <button className="secondaryButton" type="button" disabled={submitting} onClick={() => setStep("gate")}>
                Back
              </button>
              <button className="primaryAction" type="submit" disabled={submitting}>
                {submitting ? <RefreshCw size={18} className="spin" /> : <ArrowRight size={18} />}
                {submitting ? "Starting..." : "Create account"}
              </button>
            </div>
          </form>
        )}

        <div className="accessMode">
          <Cloud size={16} />
          {cloudMode ? "Responses will sync to the configured Cloudflare Worker." : "Local mode: responses stay in this browser until Cloudflare is configured."}
        </div>
        {status && <div className="statusBanner">{status}</div>}
      </section>
    </main>
  );
}

function Input({ icon, label, value, onChange, type = "text", ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inputWrap">
        {icon}
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
      </div>
    </label>
  );
}

function WelcomePage({ study, onStart }) {
  return (
    <main className="page">
      <section className="welcomeGrid">
        <div className="welcomeIntro">
          <div className="eyebrow">Study task</div>
          <h1>Compare SOAP outputs from the same therapy session.</h1>
          <p>
            You will review every pairwise comparison among {study.outputCount} anonymous outputs. For each pair, choose the output that is more clinically useful, faithful to the session, complete, and well organized. You may also mark a tie.
          </p>
          <p>
            The optional note is for the reason behind your decision: missing clinical details, unsafe risk handling, weak plan, poor structure, hallucinated content, or anything else that shaped your judgment.
          </p>
          <button className="primaryAction wide" type="button" onClick={onStart}>
            <ArrowRight size={18} />
            Begin {study.comparisonCount} comparisons
          </button>
        </div>

      </section>

      <section className="instructionBand">
        <div>
          <h2>What to prioritize</h2>
          <p>Prefer the output that best supports a clinician reviewing the session: accurate subjective details, grounded observations, appropriate assessment, risk awareness, and a specific plan.</p>
        </div>
        <div>
          <h2>Transcript access</h2>
          <p>The original Arabic transcript is available during review. When a comparison includes an output generated from Fanar’s English translation, the translated transcript is available as well.</p>
        </div>
      </section>
    </main>
  );
}

function ReviewPage({
  study,
  profile,
  outputMap,
  sequence,
  activeItem,
  activeComparisonId,
  setActiveComparisonId,
  responses,
  responseMap,
  onSave,
}) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [transcript, setTranscript] = useState(null);
  const [saving, setSaving] = useState(false);

  const leftOutput = activeItem ? outputMap.get(activeItem.leftOutputId) : null;
  const rightOutput = activeItem ? outputMap.get(activeItem.rightOutputId) : null;
  const existing = activeItem ? responseMap.get(activeItem.comparisonId) : null;
  const position = activeItem ? sequence.findIndex((item) => item.comparisonId === activeItem.comparisonId) + 1 : 0;
  const requiresTranslation = Boolean(leftOutput?.usesTranslatedTranscript || rightOutput?.usesTranslatedTranscript);
  const allDone = responses.length >= study.comparisonCount;

  useEffect(() => {
    if (!activeItem) return;
    const saved = responseMap.get(activeItem.comparisonId);
    setChoice(saved?.winner_choice || "");
    setNote(saved?.note || "");
  }, [activeItem, responseMap]);

  async function submit() {
    if (!activeItem || !choice || !leftOutput || !rightOutput) return;
    const selectedOutputId = choice === "left" ? leftOutput.id : choice === "right" ? rightOutput.id : null;
    const response = {
      id: responseId(profile.participant_id, activeItem.comparisonId),
      participant_id: profile.participant_id,
      participant_email: profile.email,
      comparison_id: activeItem.comparisonId,
      sequence_index: activeItem.sequenceIndex,
      left_output_id: leftOutput.id,
      right_output_id: rightOutput.id,
      winner_choice: choice,
      selected_output_id: selectedOutputId,
      note: note.trim() || null,
      timestamp_utc: nowUtc(),
      user_agent: navigator.userAgent,
      page_url: window.location.href,
    };

    setSaving(true);
    await onSave(response);
    setSaving(false);
  }

  if (!activeItem || !leftOutput || !rightOutput) {
    return (
      <main className="page">
        <CompletionPanel study={study} responses={responses} />
      </main>
    );
  }

  return (
    <main className="reviewLayout">
      <aside className="queuePanel" aria-label="Comparison queue">
        <div className="queueHeader">
          <div>
            <div className="eyebrow">Queue</div>
            <h2>{responses.length}/{study.comparisonCount}</h2>
          </div>
          <button className="ghostButton" type="button" onClick={() => go(ROUTES.stats)}>
            <BarChart3 size={16} />
            Stats
          </button>
        </div>

        <div className="queueGrid">
          {sequence.map((item) => {
            const answered = responseMap.has(item.comparisonId);
            return (
              <button
                key={item.comparisonId}
                className={`queueItem ${answered ? "done" : ""} ${activeComparisonId === item.comparisonId ? "active" : ""}`}
                type="button"
                onClick={() => setActiveComparisonId(item.comparisonId)}
                aria-label={`Comparison ${item.sequenceIndex}`}
              >
                {answered ? <Check size={14} /> : item.sequenceIndex}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="comparisonWorkspace">
        <div className="comparisonHeader">
          <div>
            <div className="eyebrow">Comparison {position} of {study.comparisonCount}</div>
            <h1>{leftOutput.label} vs {rightOutput.label}</h1>
          </div>
          <div className="headerActions">
            <button className="secondaryButton" type="button" onClick={() => setTranscript({ title: "Original Arabic Transcript", subtitle: "Source therapy session", text: study.transcripts.originalArabic })}>
              <FileText size={17} />
              Transcript
            </button>
            {requiresTranslation && (
              <button className="secondaryButton" type="button" onClick={() => setTranscript({ title: "Fanar English Translation", subtitle: "Translation used by one or both outputs in this comparison", text: study.transcripts.fanarEnglish })}>
                <Languages size={17} />
                Translation
              </button>
            )}
          </div>
        </div>

        {allDone && <div className="doneBanner">All required comparisons have responses. You can still revise any item from the queue.</div>}

        <div className="outputGrid">
          <OutputCard title="Option 1" output={leftOutput} active={choice === "left"} />
          <OutputCard title="Option 2" output={rightOutput} active={choice === "right"} />
        </div>

        <section className="decisionPanel">
          <div className="decisionHeader">
            <div>
              <h2>Your judgment</h2>
              <p>{existing ? "This comparison already has a saved response. Saving again will update it." : "Choose the better output, or mark a tie if neither is clearly stronger."}</p>
            </div>
          </div>

          <div className="choiceBar" role="radiogroup" aria-label="Preference choice">
            <ChoiceButton active={choice === "left"} icon={<CheckCircle2 size={20} />} label={`Prefer ${leftOutput.label}`} help="Option 1 is stronger" onClick={() => setChoice("left")} />
            <ChoiceButton active={choice === "tie"} icon={<Scale size={20} />} label="Tie" help="No clear preference" onClick={() => setChoice("tie")} />
            <ChoiceButton active={choice === "right"} icon={<CheckCircle2 size={20} />} label={`Prefer ${rightOutput.label}`} help="Option 2 is stronger" onClick={() => setChoice("right")} />
          </div>

          <label className="noteField">
            <span>Optional note</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="Reasoning behind your decision" />
          </label>

          <div className="decisionActions">
            <button
              className="ghostButton"
              type="button"
              disabled={position <= 1}
              onClick={() => {
                const previous = sequence[position - 2];
                if (previous) setActiveComparisonId(previous.comparisonId);
              }}
            >
              <ArrowLeft size={17} />
              Previous
            </button>
            <button className="primaryAction" type="button" disabled={!choice || saving} onClick={() => void submit()}>
              {saving ? <RefreshCw size={18} className="spin" /> : <Check size={18} />}
              {existing ? "Update response" : "Save and continue"}
            </button>
            <button
              className="ghostButton"
              type="button"
              disabled={position >= sequence.length}
              onClick={() => {
                const next = sequence[position];
                if (next) setActiveComparisonId(next.comparisonId);
              }}
            >
              Next
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
      </section>

      {transcript && <TextModal {...transcript} onClose={() => setTranscript(null)} />}
    </main>
  );
}

function OutputCard({ title, output, active }) {
  return (
    <article className={`outputCard ${active ? "selected" : ""}`}>
      <div className="outputHeader">
        <div>
          <div className="optionLabel">{title}</div>
          <h2>{output.label}</h2>
        </div>
        {output.usesTranslatedTranscript && <span className="sourcePill">Fanar translation source</span>}
      </div>
      <OutputViewer output={output} />
    </article>
  );
}

function ChoiceButton({ active, icon, label, help, onClick }) {
  return (
    <button className={`choiceButton ${active ? "active" : ""}`} type="button" role="radio" aria-checked={active} onClick={onClick}>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{help}</small>
      </span>
    </button>
  );
}

function CompletionPanel({ study, responses }) {
  return (
    <section className="completionPanel">
      <div className="eyebrow">Complete</div>
      <h1>All comparisons are answered.</h1>
      <p>You have completed {responses.length} of {study.comparisonCount} required pairwise judgments.</p>
      <button className="primaryAction" type="button" onClick={() => go(ROUTES.stats)}>
        <BarChart3 size={18} />
        View statistics
      </button>
    </section>
  );
}

function StatsPage({ study, profile, sequence, responses, responseMap, remoteStats, onRefreshRemoteStats }) {
  const outputWins = useMemo(() => {
    const rows = study.outputs.map((output) => ({
      id: output.id,
      label: output.label,
      wins: responses.filter((response) => response.selected_output_id === output.id).length,
      appearances: responses.filter((response) => response.left_output_id === output.id || response.right_output_id === output.id).length,
    }));
    return rows.sort((a, b) => b.wins - a.wins || a.label.localeCompare(b.label));
  }, [responses, study.outputs]);
  const tieCount = responses.filter((response) => response.winner_choice === "tie").length;
  const remaining = Math.max(study.comparisonCount - responses.length, 0);

  function exportResponses() {
    downloadJson(`sakina-soap-responses-${profile.participant_id}.json`, {
      exported_at_utc: nowUtc(),
      participant: profile,
      local_summary: {
        total_comparisons_made: responses.length,
        required_comparisons: study.comparisonCount,
        ties: tieCount,
      },
      responses,
    });
  }

  return (
    <main className="page statsPage">
      <section className="statsHeader">
        <div>
          <div className="eyebrow">Statistics</div>
          <h1>Review progress and local results</h1>
        </div>
        <div className="statsActions">
          {apiEnabled() && (
            <button className="secondaryButton" type="button" onClick={() => void onRefreshRemoteStats()}>
              <RefreshCw size={17} />
              Refresh Cloudflare stats
            </button>
          )}
          <button className="primaryAction" type="button" onClick={exportResponses}>
            <Download size={17} />
            Export responses
          </button>
        </div>
      </section>

      <section className="metricGrid">
        <Metric label="Total comparisons made" value={responses.length} />
        <Metric label="Required comparisons" value={study.comparisonCount} />
        <Metric label="Remaining" value={remaining} />
        <Metric label="Ties" value={tieCount} />
      </section>

      {remoteStats && (
        <section className="remoteStats">
          <h2>Cloudflare totals</h2>
          <div className="metricGrid compactMetrics">
            <Metric label="All stored responses" value={remoteStats.total_responses ?? 0} />
            <Metric label="Participants" value={remoteStats.total_participants ?? 0} />
            <Metric label="Distinct comparisons" value={remoteStats.distinct_comparisons ?? 0} />
          </div>
        </section>
      )}

      <section className="statsGrid">
        <div className="statsPanel">
          <h2>Preference counts</h2>
          <div className="rankList">
            {outputWins.map((row) => (
              <div className="rankRow" key={row.id}>
                <span>{row.label}</span>
                <div className="rankBar">
                  <div style={{ width: `${responses.length ? (row.wins / responses.length) * 100 : 0}%` }} />
                </div>
                <strong>{row.wins}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="statsPanel">
          <h2>Pair coverage</h2>
          <div className="pairTableWrap">
            <table className="pairTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pair</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {sequence.map((item) => {
                  const left = study.outputs.find((output) => output.id === item.leftOutputId);
                  const right = study.outputs.find((output) => output.id === item.rightOutputId);
                  const response = responseMap.get(item.comparisonId);
                  return (
                    <tr key={item.comparisonId}>
                      <td>{item.sequenceIndex}</td>
                      <td>{left?.label} vs {right?.label}</td>
                      <td>{response ? "Done" : "Open"}</td>
                      <td>{response ? CHOICE_LABELS[response.winner_choice] : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="metricValue">{value}</div>
      <div className="metricLabel">{label}</div>
    </div>
  );
}

export default App;
