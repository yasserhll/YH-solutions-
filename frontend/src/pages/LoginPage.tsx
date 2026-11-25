import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CloudOff, Loader2 } from 'lucide-react';
import axios from 'axios';
import { useConnectivity } from '../components/ConnectionStatus';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorMessage } from '../api/client';
import { Brand } from '../components/ui/Brand';
import { homePath } from '../utils/modules';
import { TextField } from '../components/ui/Field';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { online } = useConnectivity();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      // replace: the login page must not stay behind the app in the history,
      // or the phone's Back button would bring it back as if logged out.
      navigate('/', { replace: true });
    } catch (err) {
      // No answer: say it plainly, it's not a wrong password.
      setError(
        axios.isAxiosError(err) && !err.response
          ? 'Pas de connexion au serveur. La première connexion à un compte demande le réseau ; ensuite l’application fonctionne aussi hors ligne.'
          : apiErrorMessage(err, 'Identifiants incorrects.'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  // Already logged in (e.g. Back reached an old /login entry): straight back into the app.
  if (user) return <Navigate to={homePath(user) ?? '/'} replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 safe-p dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm dark:bg-slate-900">
        <div className="mb-6 flex justify-center">
          <Brand markClassName="h-10" textClassName="text-xl" />
        </div>
        <h1 className="mb-1 text-center text-lg font-semibold text-slate-900 dark:text-slate-100">Gestion RH & Administrative</h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">Connectez-vous à votre espace</p>

        {!online && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
            <CloudOff size={16} className="mt-0.5 shrink-0" />
            <span>Hors connexion. Se connecter à un compte demande le réseau ; une fois connecté, l’application fonctionne hors ligne et ne vous déconnecte plus.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@transwin-mining.com"
          />
          <TextField
            label="Mot de passe"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}
