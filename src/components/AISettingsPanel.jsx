import React, { useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2, Check, Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearAICache } from "@/lib/localApi";
import { activateAICredential, createAICredential, deleteAICredential, getAICredentials, getActiveAICredentialId, listAICredentialModels, loadAICredentials, testActiveCredentialAI, updateAICredential } from "@/lib/aiSettings";
import { useAuth } from "@/lib/AuthContext";

const EMPTY = { name: "", type: "official", provider: "openai", baseUrl: "", apiKey: "", model: "", fastModel: "" };
const errorText = (error) => error?.code === "AUTH_REQUIRED" ? "请先登录以安全保存 API" : error?.code === "AI_CREDENTIALS_NOT_CONFIGURED" ? "服务器尚未配置凭据加密或 Supabase 服务端访问" : error?.message || "操作失败，请检查连接后重试";

export function AISettingsButton({ children = "API 设置", className = "", onClick }) {
  return <button type="button" onClick={(event) => { onClick?.(event); window.dispatchEvent(new Event("lingoclub:open-ai-settings")); }} className={className}>{children}</button>;
}

export function AISettingsNotice() {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const show = (event) => setNotice(event.detail?.message || "API 尚未配置");
    window.addEventListener("lingoclub:ai-not-configured", show);
    window.addEventListener("lingoclub:ai-route-incomplete", show);
    return () => { window.removeEventListener("lingoclub:ai-not-configured", show); window.removeEventListener("lingoclub:ai-route-incomplete", show); };
  }, []);
  if (!notice) return null;
  return <div role="status" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-[180] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-copper/40 bg-card px-4 py-2.5 text-sm text-foreground shadow-xl md:bottom-6"><span>{notice}</span><AISettingsButton className="shrink-0 font-medium text-copper">API 设置 →</AISettingsButton><button type="button" onClick={() => setNotice("")} className="text-muted-foreground" aria-label="关闭">×</button></div>;
}

export function AISettingsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener("lingoclub:open-ai-settings", show); return () => window.removeEventListener("lingoclub:open-ai-settings", show); }, []);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] w-[calc(100%-1rem)] overflow-y-auto border-border bg-background p-0 text-foreground sm:max-w-2xl"><DialogHeader className="px-5 pt-5"><DialogTitle>API 服务</DialogTitle><DialogDescription>凭据加密保存在你的账号中，可在其他设备使用。</DialogDescription></DialogHeader><div className="px-5 pb-5"><AISettingsPanel embedded /></div></DialogContent></Dialog>;
}

export default function AISettingsPanel({ embedded = false }) {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState(getAICredentials());
  const [activeId, setActiveId] = useState(getActiveAICredentialId());
  const [draft, setDraft] = useState(EMPTY);
  const [editingActive, setEditingActive] = useState(false);
  const [editDraft, setEditDraft] = useState({ baseUrl: "", apiKey: "", model: "", fastModel: "" });
  const [adding, setAdding] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [geminiModels, setGeminiModels] = useState([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [manualModelOpen, setManualModelOpen] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [manualFastModelOpen, setManualFastModelOpen] = useState(false);
  const [manualFastModel, setManualFastModel] = useState("");
  const [message, setMessage] = useState("");
  const [cacheMessage, setCacheMessage] = useState("");
  const activeCredential = credentials.find((item) => item.id === activeId) || null;

  const refresh = async () => {
    try { await loadAICredentials({ force: true }); setCredentials(getAICredentials()); setActiveId(getActiveAICredentialId()); }
    catch (error) { setMessage(errorText(error)); }
  };
  useEffect(() => {
    if (!user) { setCredentials([]); setActiveId(null); return; }
    let alive = true;
    loadAICredentials({ force: true }).then(() => { if (alive) { setCredentials(getAICredentials()); setActiveId(getActiveAICredentialId()); } }).catch((error) => { if (alive) setMessage(errorText(error)); });
    const update = () => { setCredentials(getAICredentials()); setActiveId(getActiveAICredentialId()); };
    window.addEventListener("lingoclub:ai-credentials-changed", update);
    return () => { alive = false; window.removeEventListener("lingoclub:ai-credentials-changed", update); };
  }, [user?.id]);

  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const provider = draft.provider;
      await createAICredential({ ...draft, provider }); setDraft(EMPTY); setAdding(false); setMessage("API 已加密保存到账户"); await refresh();
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  const activate = async (id) => { setBusy(true); setMessage(""); try { await activateAICredential(id); setActiveId(id); setCredentials(getAICredentials()); setMessage("已切换当前 API"); } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); } };
  const remove = async (id) => { if (!window.confirm("删除这套 API 配置？")) return; setBusy(true); try { await deleteAICredential(id); await refresh(); setMessage("配置已删除"); } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); } };
  const saveProvider = async (provider) => {
    if (!activeCredential || provider === activeCredential.provider) return;
    setProviderBusy(true); setMessage("");
    try { await updateAICredential(activeCredential.id, { provider }); setCredentials(getAICredentials()); setMessage("接口协议已保存；加密 API Key 未更改"); }
    catch (error) { setMessage(errorText(error)); }
    finally { setProviderBusy(false); }
  };
  const refreshGeminiModels = async () => {
    if (!activeCredential) return;
    setModelsBusy(true); setMessage(""); setGeminiModels([]);
    try {
      const result = await listAICredentialModels(activeCredential.id);
      setGeminiModels(result.models || []);
      setMessage(`已读取 ${result.models?.length || 0} 个支持 generateContent 的模型`);
    } catch (error) { setMessage(error?.code === "GEMINI_MODELS_UNAVAILABLE" ? "Gemini API Key 无效或无法访问模型列表" : errorText(error)); }
    finally { setModelsBusy(false); }
  };
  const saveModelField = async (field, value) => {
    if (!activeCredential || (field !== "fast_model" && !value.trim())) return;
    setProviderBusy(true); setMessage("");
    try { await updateAICredential(activeCredential.id, { [field]: value.trim() }); setCredentials(getAICredentials()); setMessage("模型已保存"); }
    catch (error) { setMessage(errorText(error)); }
    finally { setProviderBusy(false); }
  };
  const beginEditActive = () => {
    if (!activeCredential) return;
    setEditDraft({ baseUrl: activeCredential.baseUrl || "", apiKey: "", model: activeCredential.model || "", fastModel: activeCredential.fastModel || "" });
    setEditingActive(true);
    setMessage("");
  };
  const saveActiveEdit = async (event) => {
    event.preventDefault();
    if (!activeCredential || !editDraft.model.trim()) { setMessage("Model 不能为空"); return; }
    setBusy(true); setMessage("");
    try {
      const patch = { model: editDraft.model.trim(), fastModel: editDraft.fastModel.trim() };
      if (activeCredential.type === "relay") patch.baseUrl = editDraft.baseUrl.trim();
      // An empty key means keep the encrypted credential as-is.
      if (editDraft.apiKey.trim()) patch.apiKey = editDraft.apiKey.trim();
      await updateAICredential(activeCredential.id, patch);
      setCredentials(getAICredentials());
      setEditingActive(false);
      setEditDraft((current) => ({ ...current, apiKey: "" }));
      setMessage("当前 API 已更新；留空的 API Key 保持不变");
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  const runTest = async () => {
    if (!activeCredential) return;
    setTestBusy(true); setTestResult(null);
    try { setTestResult(await testActiveCredentialAI(activeCredential.id)); }
    catch (error) { setTestResult({ error: safeTestError(error), code: error?.code, upstreamStatus: error?.upstreamStatus, upstreamCode: error?.upstreamCode, availableModels: error?.availableModels, modelsStatus: error?.modelsStatus, modelsEndpoint: error?.modelsEndpoint, endpoint: error?.endpoint }); }
    finally { setTestBusy(false); }
  };
  const clearCache = () => { const removed = clearAICache(); setCacheMessage(`已清除 ${removed} 条 AI 解析缓存`); };

  return <section id={embedded ? undefined : "ai-settings"} className={`${embedded ? "" : "mt-8 rounded-xl border border-border/60 bg-card p-4 sm:p-5"} space-y-4`}>
    {!embedded && <div><h2 className="font-medium text-foreground">API 服务</h2><p className="mt-1 text-xs text-muted-foreground">中转站使用 OpenAI-compatible；官方 Gemini 和 OpenAI 分别使用各自官方接口。</p></div>}
    {!user ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">登录后可添加并同步你的 API 配置。</p> : <>
      <div className="space-y-2">{credentials.map((item) => <div key={item.id} className={`flex items-center gap-3 rounded-xl border p-3 ${item.id === activeId ? "border-mint/50 bg-mint/5" : "border-border/70"}`}>
        <button type="button" onClick={() => activate(item.id)} disabled={busy} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background-elev text-mint">{item.id === activeId ? <Check size={16} /> : <KeyRound size={15} />}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}{item.id === activeId ? <span className="ml-2 text-[10px] text-mint">当前使用</span> : null}</span><span className="block truncate text-xs text-muted-foreground">{credentialLabel(item)} · {item.model} · {item.maskedApiKey}</span></span></button>
        <button type="button" onClick={() => remove(item.id)} disabled={busy} aria-label={`删除 ${item.name}`} className="rounded-full p-2 text-muted-foreground hover:text-destructive"><Trash2 size={15} /></button>
      </div>)}</div>
      {activeCredential && <div className="space-y-2 rounded-xl border border-border/70 p-3">
        {!editingActive ? <button type="button" disabled={busy || testBusy} onClick={beginEditActive} className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50">重新编辑当前 API</button> : <form onSubmit={saveActiveEdit} className="space-y-2 rounded-lg bg-background/60 p-3">
          <p className="text-xs text-muted-foreground">修改当前配置不会删除 credential。API Key 留空则保留现有密钥。</p>
          {activeCredential.type === "relay" && <Field label="Base URL" value={editDraft.baseUrl} onChange={(value) => setEditDraft((current) => ({ ...current, baseUrl: value }))} required />}
          <label className="block space-y-1 text-sm"><span>API Key（留空保留当前密钥）</span><input type="password" autoComplete="new-password" value={editDraft.apiKey} onChange={(event) => setEditDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder={activeCredential.maskedApiKey || "留空保留当前密钥"} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <Field label="Model" value={editDraft.model} onChange={(value) => setEditDraft((current) => ({ ...current, model: value }))} required />
          <Field label="Fast Model（可选）" value={editDraft.fastModel} onChange={(value) => setEditDraft((current) => ({ ...current, fastModel: value }))} />
          <div className="flex gap-2"><button type="submit" disabled={busy} className="rounded-full bg-mint px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50">{busy ? "保存中…" : "保存修改"}</button><button type="button" onClick={() => { setEditingActive(false); setEditDraft((current) => ({ ...current, apiKey: "" })); }} className="rounded-full border border-border px-3 py-1.5 text-xs">取消</button></div>
        </form>}
        <button type="button" disabled={testBusy || providerBusy} onClick={runTest} className="rounded-full bg-mint px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50">{testBusy ? "正在测试连接和词条分析…" : "测试当前模型"}</button>
        {activeCredential.type === "official" && activeCredential.provider === "gemini" && <div className="space-y-2 rounded-lg bg-background/60 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">官方 Gemini 模型</span><button type="button" disabled={modelsBusy} onClick={refreshGeminiModels} className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground disabled:opacity-50">{modelsBusy ? "读取中…" : "读取可用模型"}</button></div>
          {geminiModels.length > 0 && <>
            <label className="block space-y-1 text-xs"><span>Model</span><select value={geminiModels.some((model) => model.id === activeCredential.model) ? activeCredential.model : "__manual__"} disabled={providerBusy} onChange={(event) => event.target.value !== "__manual__" && saveModelField("model", event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="__manual__">手动输入 / 当前 ID</option>{geminiModels.map((model) => <option key={model.id} value={model.id}>{model.id}{/flash/i.test(model.id) ? " · Flash" : ""}</option>)}</select></label>
            <label className="block space-y-1 text-xs"><span>Fast Model（可选）</span><select value={!activeCredential.fastModel ? "__primary__" : geminiModels.some((model) => model.id === activeCredential.fastModel) ? activeCredential.fastModel : "__manual__"} disabled={providerBusy} onChange={(event) => { if (event.target.value === "__primary__") saveModelField("fast_model", ""); else if (event.target.value !== "__manual__") saveModelField("fast_model", event.target.value); }} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="__primary__">跟随 Model（{activeCredential.model}）</option><option value="__manual__">保留当前 Fast Model</option>{geminiModels.map((model) => <option key={model.id} value={model.id}>{model.id}{/flash/i.test(model.id) ? " · Flash" : ""}</option>)}</select></label>
          </>}
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setManualModel(activeCredential.model || ""); setManualModelOpen((value) => !value); }} className="text-xs text-muted-foreground underline">手动输入 Model ID</button><button type="button" onClick={() => { setManualFastModel(activeCredential.fastModel || ""); setManualFastModelOpen((value) => !value); }} className="text-xs text-muted-foreground underline">手动输入 Fast Model</button></div>
          {manualModelOpen && <div className="flex gap-2"><input value={manualModel} onChange={(event) => setManualModel(event.target.value)} aria-label="手动输入 Gemini Model ID" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs" /><button type="button" onClick={() => saveModelField("model", manualModel)} className="rounded-lg border border-border px-3 text-xs">保存</button></div>}
          {manualFastModelOpen && <div className="flex gap-2"><input value={manualFastModel} onChange={(event) => setManualFastModel(event.target.value)} aria-label="手动输入 Gemini Fast Model ID" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs" /><button type="button" onClick={() => saveModelField("fast_model", manualFastModel)} className="rounded-lg border border-border px-3 text-xs">保存</button></div>}
        </div>}
        {testResult && <CredentialTestResult result={testResult} />}
        {activeCredential.type === "relay" && <p className="text-xs text-muted-foreground">中转站使用已保存的接口协议：{activeCredential.provider === "gemini" ? "Gemini-compatible generateContent" : "OpenAI-compatible Chat Completions"}。</p>}
      </div>}
      {credentials.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">尚未添加 API。选择官方 OpenAI、官方 Gemini 或 OpenAI-compatible 中转站。</p>}
      {!adding ? <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-full border border-copper/40 px-4 py-2 text-sm text-copper"><Plus size={15} />添加 API</button> : <form onSubmit={submit} className="space-y-3 rounded-xl border border-border/70 p-4">
        <Field label="名称" value={draft.name} onChange={(value) => setField("name", value)} placeholder="例如：我的中转站" required />
        <div className="grid grid-cols-2 gap-2"><Choice active={draft.type === "official"} onClick={() => setDraft({ ...draft, type: "official", provider: "openai", baseUrl: "" })}>官方 API</Choice><Choice active={draft.type === "relay"} onClick={() => setDraft({ ...draft, type: "relay", provider: "gemini" })}>中转站 · Gemini-compatible</Choice></div>
        {draft.type === "official" && <label className="block space-y-1 text-sm"><span>Provider</span><select value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value, baseUrl: "" })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="openai">OpenAI · Responses API</option><option value="gemini">Gemini · generateContent</option></select><span className="block text-xs text-muted-foreground">Base URL：{draft.provider === "gemini" ? "https://generativelanguage.googleapis.com" : "https://api.openai.com/v1"}</span></label>}
        {draft.type === "relay" && <Field label="Base URL" value={draft.baseUrl} onChange={(value) => setField("baseUrl", value)} placeholder="https://api.lk888.ai/v1" required />}
        <label className="block space-y-1 text-sm"><span>API Key</span><span className="flex rounded-lg border border-border bg-background"><input required type={showKey ? "text" : "password"} autoComplete="new-password" value={draft.apiKey} onChange={(event) => setField("apiKey", event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none" /><button type="button" onClick={() => setShowKey((value) => !value)} className="px-3 text-muted-foreground" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
        <Field label="Model" value={draft.model} onChange={(value) => setField("model", value)} placeholder="输入 model ID" required />
        <Field label="Fast Model（可选）" value={draft.fastModel} onChange={(value) => setField("fastModel", value)} placeholder="留空时使用 Model" />
        {draft.type === "relay" && <p className="text-xs text-muted-foreground">Gemini-compatible 中转站使用 generateContent；Model ID 由你填写。</p>}
        <p className="text-xs text-muted-foreground">API Key 由服务端加密后与账号关联；保存 credential 与测试模型相互独立。</p>
        <div className="flex gap-2"><button disabled={busy} className="rounded-full bg-mint px-4 py-2 text-sm font-medium text-background">{busy ? <Loader2 size={15} className="animate-spin" /> : "保存 API"}</button><button type="button" onClick={() => { setAdding(false); setDraft(EMPTY); }} className="rounded-full border border-border px-4 py-2 text-sm">取消</button></div>
      </form>}
    </>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <button type="button" onClick={clearCache} className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground">清除 AI 解析缓存</button>{cacheMessage && <span role="status" className="ml-2 text-xs text-mint">{cacheMessage}</span>}
  </section>;
}

function credentialLabel(item) { if (item.type === "relay") return `中转站 · ${item.provider === "gemini" ? "Gemini-compatible" : "OpenAI-compatible"}`; return item.provider === "gemini" ? "官方 Gemini" : "官方 OpenAI"; }
function safeTestError(error) {
  if (error?.code === "AUTH_ERROR") return "API Key 无效或无调用权限";
  if (error?.code === "MODEL_NOT_AVAILABLE") return "当前 API Key 无权使用此模型";
  if (error?.code === "BILLING_OR_QUOTA_ERROR") return "额度或账单状态异常";
  if (error?.code === "RATE_LIMIT") return "请求达到速率限制";
  if (error?.code === "ENDPOINT_NOT_FOUND") return "Endpoint 404";
  if (error?.code === "REQUEST_FORMAT_ERROR") return "请求格式不兼容";
  if (error?.code === "GEMINI_TEXT_MODEL_REQUIRED") return "该模型用于语音生成，不能用于文本分析";
  if (error?.code === "UPSTREAM_OK_PARSE_FAILED") return "上游成功，但响应无法解析";
  if (error?.code === "NETWORK_ERROR") return "网络或上游服务连接失败";
  if (error?.code === "GEMINI_MODELS_UNAVAILABLE") return "Gemini API Key 无效或无法访问模型列表";
  if (error?.code === "GEMINI_MODELS_TIMEOUT") return "Gemini 模型列表请求超时";
  if (error?.code === "GEMINI_API_KEY_INVALID") return "Gemini API Key 无效";
  if (error?.code === "GEMINI_OFFICIAL_404") return "Gemini 官方接口返回 404";
  if (error?.code === "MODEL_NOT_AVAILABLE") return `当前 Gemini API Key 无权使用 ${error.model || "此模型"}`;
  if (error?.code === "AI_MODEL_NOT_FOUND") return "Model 不存在";
  if (error?.code === "AI_PROVIDER_AUTH") return "API Key 无效";
  if (error?.code === "AI_UPSTREAM_404") return "Endpoint 404";
  if (error?.code === "AI_RATE_LIMIT") return "额度不足或触发限流";
  if (error?.code === "AI_REQUEST_FORMAT_INCOMPATIBLE") return "请求格式不兼容";
  if (error?.code === "AI_TIMEOUT") return "请求超时";
  return error?.message || "AI 请求失败";
}
function CredentialTestResult({ result }) {
  const record = result.connection || {};
  const connection = record.payload?.connection;
  const success = record.status === 200 && connection?.ok;
  const safeError = record.code ? safeTestError(record) : record.error || "连接失败";
  return <p role="status" className={`text-xs ${success ? "text-mint" : "text-amber-200"}`}>{success ? "连接成功" : safeError}</p>;
}
function Choice({ active, onClick, children }) { return <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-lg border px-3 py-2 text-sm ${active ? "border-mint/50 bg-mint/10 text-mint" : "border-border text-muted-foreground"}`}>{children}</button>; }
function Field({ label, value, onChange, placeholder, required = false }) { return <label className="block space-y-1 text-sm"><span>{label}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>; }
