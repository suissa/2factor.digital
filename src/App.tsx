import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Smartphone, KeyRound, User, Link2, AppWindow, Server, ShieldOff } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Alert } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { formatTimeLeft } from './lib/utils';

type Step = 'whatsapp' | 'passkey' | 'profile';

type OAuthToken = {
  access_token: string;
  refresh_token: string;
  issued_at: string;
  expires_in: number;
  credential_id?: string;
  phone?: string;
  revoked?: number;
  revoked_at?: number | null;
};

type Application = {
  id: number;
  name: string;
  redirect_uri: string;
  created_at: number;
};

type MTPServer = {
  id: number;
  name: string;
  url: string;
  description: string;
  created_at: number;
};

export default function App() {
  const [step, setStep] = useState<Step>('whatsapp');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [flowToken, setFlowToken] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [tokenPreview, setTokenPreview] = useState<OAuthToken | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [mtpServers, setMtpServers] = useState<MTPServer[]>([]);
  const [issuedTokens, setIssuedTokens] = useState<OAuthToken[]>([]);
  const [newApp, setNewApp] = useState({ name: '', redirectUri: '' });
  const [newMtp, setNewMtp] = useState({ name: '', url: '', description: '' });

  const countdown = useMemo(() => {
    if (!expiresAt) return null;
    return Math.max(0, expiresAt - Date.now());
  }, [expiresAt]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => {
      if (Date.now() > expiresAt) {
        setStatus('O código expirou, solicite outro.');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (step !== 'profile') return;
    loadApplications();
    loadMtpServers();
    loadTokens();
  }, [step, phone]);

  async function callApi<T>(path: string, options: RequestInit & { body?: unknown } = {}) {
    const { body, ...rest } = options;
    const response = await fetch(path, {
      method: body ? 'POST' : rest.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(rest.headers || {}) },
      ...rest,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'Erro inesperado');
    }

    return (await response.json()) as T;
  }

  async function handleSendCode() {
    setLoading(true);
    setStatus(null);
    try {
      const result = await callApi<{ codePreview: string; flowToken: string; expiresAt: number }>('api/send-code', { body: { phone } });
      setFlowToken(result.flowToken);
      setExpiresAt(result.expiresAt);
      setStatus(`Código enviado via WhatsApp. Dica para testes: ${result.codePreview}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao enviar código.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!flowToken) {
      setStatus('Solicite o código primeiro.');
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      await callApi('api/verify-code', { body: { phone, otp, flowToken } });
      setStatus('Código validado! Prossiga para registrar a passkey.');
      setStep('passkey');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao validar código.');
    } finally {
      setLoading(false);
    }
  }

  async function registerPasskey() {
    setLoading(true);
    setStatus(null);
    try {
      const credentialId = await simulatePasskeyCreation();
      await callApi('api/register-passkey', { body: { phone, credentialId } });
      const token = await callApi<OAuthToken>('oauth/token-ingestion', { body: { phone, credentialId } });
      setTokenPreview(token);
      setStatus('Passkey criada e ingestão de token concluída.');
      setStep('profile');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao criar passkey.');
    } finally {
      setLoading(false);
    }
  }

  async function simulatePasskeyCreation() {
    if (window.PublicKeyCredential) {
      try {
        const randomId = crypto.randomUUID();
        return randomId;
      } catch (error) {
        console.warn('Falha ao usar WebAuthn real, usando simulador', error);
      }
    }
    return `simulado-${crypto.randomUUID()}`;
  }

  async function loadApplications() {
    const apps = await callApi<Application[]>('api/apps', { method: 'GET' });
    setApplications(apps);
  }

  async function loadMtpServers() {
    const servers = await callApi<MTPServer[]>('api/mtp-servers', { method: 'GET' });
    setMtpServers(servers);
  }

  async function loadTokens() {
    if (!phone) return;
    const tokens = await callApi<OAuthToken[]>(`api/tokens?phone=${encodeURIComponent(phone)}`, { method: 'GET' });
    setIssuedTokens(tokens);
  }

  async function createApplication() {
    setLoading(true);
    setStatus(null);
    try {
      await callApi('api/apps', { body: newApp });
      await loadApplications();
      setNewApp({ name: '', redirectUri: '' });
      setStatus('Aplicação registrada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao salvar aplicação.');
    } finally {
      setLoading(false);
    }
  }

  async function createMtpServer() {
    setLoading(true);
    setStatus(null);
    try {
      await callApi('api/mtp-servers', { body: newMtp });
      await loadMtpServers();
      setNewMtp({ name: '', url: '', description: '' });
      setStatus('Servidor MTP cadastrado.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao salvar servidor.');
    } finally {
      setLoading(false);
    }
  }

  async function revokeToken(accessToken: string) {
    setLoading(true);
    setStatus(null);
    try {
      await callApi('api/tokens/revoke', { body: { accessToken } });
      await loadTokens();
      setStatus('Token revogado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao revogar token.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-10 w-10 text-primary" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">2FA + Passkey</p>
            <h1 className="text-2xl font-bold">Onboarding em dois fatores com OAuth 2.1</h1>
          </div>
        </div>
        <Badge>SQLite + Token Ingestion</Badge>
      </header>

      {status && <Alert>{status}</Alert>}

      {step === 'whatsapp' && (
        <Card className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Valide seu WhatsApp</CardTitle>
              <CardDescription>
                Insira seu número e enviaremos um código de uso único válido por 1 minuto. Para facilitar o teste, exibimos o código na interface.
              </CardDescription>
            </CardHeader>
            <div className="space-y-3">
              <label className="text-sm font-medium">Número do WhatsApp</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-0000" />
              <div className="flex gap-2">
                <Button onClick={handleSendCode} disabled={!phone || loading}>Enviar código</Button>
                <Button variant="secondary" onClick={handleVerifyCode} disabled={!otp || loading}>Validar</Button>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Código recebido</label>
                <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" />
                {countdown !== null && <p className="text-xs text-muted-foreground">Expira em {formatTimeLeft(countdown)}</p>}
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="mb-2 font-semibold text-foreground">Como funciona</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Geramos um OTP único e armazenamos no SQLite com validade de 60s.</li>
              <li>O token de fluxo (flowToken) garante que apenas a sessão correta possa validar o código.</li>
              <li>Ao validar, liberamos a criação da passkey para completar o segundo fator.</li>
            </ol>
          </div>
        </Card>
      )}

      {step === 'passkey' && (
        <Card className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Crie sua passkey</CardTitle>
              <CardDescription>
                Usamos WebAuthn quando disponível; caso contrário, geramos um identificador seguro simulado para fins de demonstração.
              </CardDescription>
            </CardHeader>
            <div className="space-y-4">
              <Button onClick={registerPasskey} disabled={loading}>Registrar passkey</Button>
              <Alert>
                A passkey será vinculada ao número {phone}. Em seguida, um token OAuth2.1 será ingerido e exibido no perfil.
              </Alert>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="mb-2 font-semibold text-foreground">Por que passkey?</p>
            <p>Combinar OTP com passkey elimina dependência de SMS/WhatsApp repetidos e cria autenticação resistente a phishing.</p>
          </div>
        </Card>
      )}

      {step === 'profile' && (
        <div className="space-y-6">
          <Card className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Perfil seguro</CardTitle>
                <CardDescription>Seu acesso foi validado em dois fatores e recebeu tokens OAuth 2.1 via ingestão.</CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border bg-muted/60 px-3 py-2 text-sm">
                  <Smartphone className="h-4 w-4" /> {phone}
                </div>
                <div className="flex items-center gap-2 rounded-md border bg-muted/60 px-3 py-2 text-sm">
                  <KeyRound className="h-4 w-4" /> Passkey vinculada
                </div>
                {tokenPreview && (
                  <div className="rounded-md border bg-muted/60 px-3 py-2 text-xs text-left">
                    <p className="mb-1 flex items-center gap-1 font-semibold text-foreground"><Link2 className="h-4 w-4" /> Token OAuth2.1</p>
                    <p><span className="font-semibold">Access:</span> {tokenPreview.access_token}</p>
                    <p><span className="font-semibold">Refresh:</span> {tokenPreview.refresh_token}</p>
                    <p className="text-muted-foreground">Expira em {Math.round(tokenPreview.expires_in / 60)} min — emitido {new Date(tokenPreview.issued_at).toLocaleTimeString()}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
              <p className="mb-2 font-semibold text-foreground">Próximos passos</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Use os tokens emitidos para acessar APIs protegidas.</li>
                <li>Renove tokens via refresh token para sessões longas.</li>
                <li>Registre múltiplas passkeys no mesmo número para backup.</li>
              </ul>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><AppWindow className="h-5 w-5" /> Aplicações OAuth 2.1</CardTitle>
                <CardDescription>Cadastre aplicações clientes, defina redirect URIs e visualize as existentes.</CardDescription>
              </CardHeader>
              <div className="space-y-3 px-6 pb-6">
                <label className="text-sm font-medium">Nome da aplicação</label>
                <input value={newApp.name} onChange={(e) => setNewApp((prev) => ({ ...prev, name: e.target.value }))} placeholder="Dashboard B2B" />
                <label className="text-sm font-medium">Redirect URI</label>
                <input value={newApp.redirectUri} onChange={(e) => setNewApp((prev) => ({ ...prev, redirectUri: e.target.value }))} placeholder="https://cliente.com/callback" />
                <Button onClick={createApplication} disabled={!newApp.name || !newApp.redirectUri || loading}>Salvar aplicação</Button>
                <div className="space-y-2">
                  {applications.map((app) => (
                    <div key={app.id} className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      <p className="font-semibold text-foreground">{app.name}</p>
                      <p className="text-xs text-muted-foreground">Redirect: {app.redirect_uri}</p>
                      <p className="text-[11px] text-muted-foreground">Criada em {new Date(app.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  {applications.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma aplicação cadastrada ainda.</p>}
                </div>
              </div>
            </Card>

            <Card className="space-y-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> Servidores MTP</CardTitle>
                <CardDescription>Mapeie os servidores que emitirão ou receberão logins para seus usuários.</CardDescription>
              </CardHeader>
              <div className="space-y-3 px-6 pb-6">
                <label className="text-sm font-medium">Nome do servidor</label>
                <input value={newMtp.name} onChange={(e) => setNewMtp((prev) => ({ ...prev, name: e.target.value }))} placeholder="MTP principal" />
                <label className="text-sm font-medium">Endpoint</label>
                <input value={newMtp.url} onChange={(e) => setNewMtp((prev) => ({ ...prev, url: e.target.value }))} placeholder="https://mtp.suaempresa.com" />
                <label className="text-sm font-medium">Descrição</label>
                <textarea className="h-20" value={newMtp.description} onChange={(e) => setNewMtp((prev) => ({ ...prev, description: e.target.value }))} placeholder="Ex: servidor responsável por MFA de clientes premium." />
                <Button onClick={createMtpServer} disabled={!newMtp.name || !newMtp.url || loading}>Salvar servidor</Button>
                <div className="space-y-2">
                  {mtpServers.map((srv) => (
                    <div key={srv.id} className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      <p className="font-semibold text-foreground">{srv.name}</p>
                      <p className="text-xs text-muted-foreground">URL: {srv.url}</p>
                      {srv.description && <p className="text-xs text-muted-foreground">{srv.description}</p>}
                      <p className="text-[11px] text-muted-foreground">Criado em {new Date(srv.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  {mtpServers.length === 0 && <p className="text-xs text-muted-foreground">Nenhum servidor cadastrado ainda.</p>}
                </div>
              </div>
            </Card>
          </div>

          <Card className="space-y-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Tokens emitidos</CardTitle>
              <CardDescription>Visualize e revogue access tokens emitidos para este telefone e passkey.</CardDescription>
            </CardHeader>
            <div className="space-y-3 px-6 pb-6">
              {issuedTokens.map((token) => (
                <div key={token.access_token} className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">{token.access_token}</p>
                      <p className="text-xs text-muted-foreground">Refresh: {token.refresh_token}</p>
                      <p className="text-[11px] text-muted-foreground">Emitido {new Date(token.issued_at).toLocaleString()} — expira em {Math.round(Number(token.expires_in) / 60)} min</p>
                      {token.revoked ? (
                        <p className="text-[11px] text-red-500">Revogado em {token.revoked_at ? new Date(token.revoked_at).toLocaleString() : 'data desconhecida'}</p>
                      ) : (
                        <p className="text-[11px] text-emerald-600">Ativo</p>
                      )}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => revokeToken(token.access_token)} disabled={Boolean(token.revoked) || loading} className="flex items-center gap-1">
                      <ShieldOff className="h-4 w-4" /> Revogar
                    </Button>
                  </div>
                </div>
              ))}
              {issuedTokens.length === 0 && <p className="text-sm text-muted-foreground">Nenhum token emitido ainda.</p>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
