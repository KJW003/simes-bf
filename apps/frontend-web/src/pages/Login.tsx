import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Shield, KeyRound, Mail, Lock, ArrowRight, CheckCircle } from 'lucide-react';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { isAuthenticated, login, authLock } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | undefined)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  useEffect(() => {
    if (!authLock.lockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [authLock.lockedUntil]);

  const locked = authLock.lockedUntil ? now < authLock.lockedUntil : false;
  const remainingMs = authLock.lockedUntil ? Math.max(0, authLock.lockedUntil - now) : 0;
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);

  const emailError = useMemo(() => {
    const show = submitted || email.length > 0;
    if (!show) return undefined;
    if (!email) return 'Email requis';
    if (!emailRegex.test(email)) return 'Email invalide';
    return undefined;
  }, [email, submitted]);

  const passwordError = useMemo(() => {
    const show = submitted || password.length > 0;
    if (!show) return undefined;
    if (!password) return 'Mot de passe requis';
    if (password.length < 6) return 'Mot de passe trop court';
    return undefined;
  }, [password, submitted]);

  const canSubmit = !emailError && !passwordError && !locked;

  const [loading, setLoading] = useState(false);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    setResetSent(false);

    if (locked) return;
    if (emailError || passwordError) return;
    setLoading(true);
    try {
      const result = await login(email, password, remember);
      if (result.ok) {
        navigate(from, { replace: true });
        return;
      }
      if (result.reason === 'locked') {
        setError('Compte verrouille temporairement suite a trop de tentatives.');
        return;
      }
      if (result.reason === 'network') {
        setError('Probleme de connexion avec le serveur. Veuillez verifier votre connexion internet et reessayer.');
        return;
      }
      setError('Identifiants invalides. Veuillez verifier votre email et mot de passe.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (emailError) return;
    setResetSent(true);
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-primary/5" />
      <div className="relative min-h-screen grid lg:grid-cols-2 gap-8 p-6 lg:p-10">
        <div className="hidden lg:flex flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-white font-bold">
              S
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">SIMES-BF</div>
              <div className="text-sm text-muted-foreground">Plateforme de gestion energetique</div>
            </div>
          </div>

          <div className="space-y-6 max-w-lg">
            <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-medium">Acces securise</div>
                <div className="text-sm text-muted-foreground">Protection contre les acces non autorises et verrouillage automatique.</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-medium">Supervision temps reel</div>
                <div className="text-sm text-muted-foreground">Suivi des sites, terrains et indicateurs en continu.</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-medium">Alertes intelligentes</div>
                <div className="text-sm text-muted-foreground">Notifications multi-canaux pour un pilotage proactif.</div>
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Besoin d'acces? Contactez l'administrateur de votre organisation.
          </div>
        </div>

        <div className="flex items-center justify-center">
          <Card className="w-full max-w-md shadow-elevated border-border/40 animate-fade-in">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center text-white font-bold text-sm">
                  S
                </div>
                <Badge variant="outline" className="text-[10px]">Secure</Badge>
              </div>
              <CardTitle className="text-2xl">
                {resetMode ? 'Reinitialiser le mot de passe' : 'Connexion'}
              </CardTitle>
              <CardDescription>
                {resetMode
                  ? 'Entrez votre email pour recevoir un lien de reinitialisation.'
                  : 'Accedez au tableau de bord securise de votre organisation.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert className="mb-4 border-severity-warning/30 bg-severity-warning-bg/40 text-severity-warning-foreground">
                  {error}
                </Alert>
              )}
              {locked && (
                <Alert className="mb-4 border-severity-critical/30 bg-severity-critical-bg/40 text-severity-critical-foreground">
                  Compte verrouille. Reessayez dans {remainingMin}m {remainingSec}s.
                </Alert>
              )}

              {resetMode ? (
                <form className="space-y-4" onSubmit={handleReset}>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="reset-email"
                        type="email"
                        className={cn("pl-9", emailError && "border-destructive")}
                        placeholder="prenom.nom@entreprise.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={locked}
                      />
                    </div>
                    {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                  </div>

                  {resetSent && (
                    <div className="flex items-center gap-2 text-sm text-severity-ok">
                      <CheckCircle className="w-4 h-4" />
                      Lien envoye. Verifiez votre boite mail.
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <Button type="button" variant="ghost" className="text-xs" onClick={() => setResetMode(false)}>
                      Retour a la connexion
                    </Button>
                    <Button type="submit" size="sm" disabled={!!emailError || locked}>
                      Envoyer le lien
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={handleLogin}>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        className={cn("pl-9", emailError && "border-destructive")}
                        placeholder="prenom.nom@entreprise.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={locked}
                      />
                    </div>
                    {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Mot de passe</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        className={cn("pl-9", passwordError && "border-destructive")}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={locked}
                      />
                    </div>
                    {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={remember} onCheckedChange={(value) => setRemember(Boolean(value))} />
                      Se souvenir de moi
                    </label>
                    <Button type="button" variant="link" className="text-xs" onClick={() => setResetMode(true)}>
                      Mot de passe oublie?
                    </Button>
                  </div>

                  <Button type="submit" className="w-full" disabled={!canSubmit || loading}>
                    {loading ? 'Connexion...' : 'Se connecter'}
                  </Button>

                  <div className="text-xs text-muted-foreground text-center">
                    Tentatives restantes: {Math.max(0, authLock.maxAttempts - authLock.failedAttempts)}
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="absolute bottom-4 right-6 text-xs text-muted-foreground">
        Version {__APP_VERSION__}
      </div>
    </div>
  );
}
