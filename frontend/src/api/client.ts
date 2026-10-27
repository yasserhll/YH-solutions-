import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  headers: { Accept: 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export async function downloadFile(url: string, params: Record<string, unknown>, fallbackFilename: string): Promise<void> {
  const response = await api.get(url, { params, responseType: 'blob' });

  const disposition = response.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackFilename;

  const blobUrl = window.URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export function apiErrorMessage(error: unknown, fallback = 'Une erreur est survenue.'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
    if (data?.errors) {
      return Object.values(data.errors).flat().join(' ');
    }
    if (data?.message) return data.message;
  }
  return fallback;
}

/**
 * Error message for a file upload (Excel imports). When a server limit
 * rejects the upload before Laravel answers — nginx's client_max_body_size
 * (413), a proxy timeout (502/504) — or production hides a crash behind a
 * bare "Server Error" (500), the generic message gave the user nothing to
 * act on; this names the actual cause.
 */
export function uploadErrorMessage(error: unknown, file?: File): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const size = file ? ` (${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} Mo)` : '';
    if (status === 413)
      return `Fichier trop volumineux pour le serveur${size} : la limite d'envoi du serveur web est trop basse (nginx : client_max_body_size, PHP : upload_max_filesize / post_max_size). Augmentez-la à 50 Mo.`;
    if (status === 502 || status === 504 || error.code === 'ECONNABORTED')
      return `Le serveur a mis trop de temps à traiter le fichier${size}. Augmentez le délai du serveur (nginx : fastcgi_read_timeout 300; PHP : max_execution_time 300) puis réessayez.`;
    if (!error.response) return "Le serveur n'a pas répondu (connexion coupée ou envoi refusé). Vérifiez la connexion et la taille du fichier.";
    const data = error.response.data as { message?: string } | undefined;
    if (status === 500 && (!data?.message || data.message === 'Server Error'))
      return "Erreur sur le serveur pendant l'import. Lancez « php artisan consommation:diagnostic » sur le serveur et regardez storage/logs/laravel.log.";
  }
  return apiErrorMessage(error, "Échec de l'import.");
}
