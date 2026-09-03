import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorMessage } from '../api/client';
import { Brand } from '../components/ui/Brand';
import { TextField } from '../components/ui/Field';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(apiErrorMessage(err, 'Identifiants incorrects.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm dark:bg-slate-900">
        <div className="mb-6 flex justify-center">
          <Brand markClassName="h-10" textClassName="text-xl" />
        </div>
        <h1 className="mb-1 text-center text-lg font-semibold text-slate-900 dark:text-slate-100">Gestion RH & Administrative</h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">Connectez-vous à votre espace</p>

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
