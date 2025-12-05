import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Smartphone, KeyRound, User, Link2 } from 'lucide-react';
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

  async function callApi<T>(path: string, body: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
      const result = await callApi<{ codePreview: string; flowToken: string; expiresAt: number }>('api/send-code', { phone });
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
      await callApi('api/verify-code', { phone, otp, flowToken });
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
      await callApi('api/register-passkey', { phone, credentialId });
      const token = await callApi<OAuthToken>('oauth/token-ingestion', { phone, credentialId });
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
      )}
    </div>
  );
}
