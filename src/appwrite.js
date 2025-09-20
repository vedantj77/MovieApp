import { Client, Databases, ID, Query, Account } from 'appwrite';

// Endpoint: use Cloud root, allow override via env
const ENDPOINT = (import.meta?.env?.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1').trim();

const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID;
const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;
const COLLECTION_ID = import.meta.env.VITE_APPWRITE_COLLECTION_ID;

const TMDB_TOKEN = import.meta.env.VITE_TMDB_API_KEY; // This should be the TMDB v4 bearer token
const API_BASE_URL = 'https://api.themoviedb.org/3';

const TMDB_HEADERS = {
  Authorization: `Bearer ${TMDB_TOKEN}`,
  Accept: 'application/json',
};

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
const database = new Databases(client);
const account = new Account(client);

// OPTIONAL: if you set collection write permissions to role:users,
// call this once on app start to make a session in the browser.
export async function ensureAnonymousSession() {
  try {
    // If session exists, this will throw 401; we ignore and create one.
    await account.get();
  } catch {
    try {
      await account.createAnonymousSession();
    } catch (err) {
      console.error('Anonymous session failed:', err);
    }
  }
}

// Helper: make a short, Appwrite-ID-safe slug from searchTerm
function slugify(term) {
  return String(term)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')   // non-alnum -> dash
    .replace(/^-+|-+$/g, '')       // trim dashes
    .slice(0, 28);                  // leave room for prefix
}

// --- Update or create search count in Appwrite ---
export const updateSearchCount = async (searchTerm, movie) => {
  if (!searchTerm) return;

  const normalized = String(searchTerm).trim().toLowerCase();
  const payload = {
    searchTerm: normalized,
    title: movie?.title ?? normalized,
    movie_id: movie?.id ?? null,
    poster_url: movie?.poster_path
      ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
      : null,
  };

  // Option A (safer against races): single-doc-per-term, custom ID
  // Requires: either no unique index, or one on searchTerm (optional but recommended).
  const docId = ID.custom(`st_${slugify(normalized)}`);

  try {
    // Try creating; if it already exists, we’ll catch and update it.
    await database.createDocument(DATABASE_ID, COLLECTION_ID, docId, {
      ...payload,
      count: 1,
    });
  } catch (err) {
    // 409 means already exists → increment
    const code = err?.code || err?.response?.status;
    if (code === 409 || String(err?.message || err).includes('already exists')) {
      try {
        const existing = await database.getDocument(DATABASE_ID, COLLECTION_ID, docId);
        await database.updateDocument(DATABASE_ID, COLLECTION_ID, docId, {
          title: payload.title ?? existing.title ?? normalized,
          poster_url: payload.poster_url ?? existing.poster_url ?? null,
          movie_id: payload.movie_id ?? existing.movie_id ?? null,
          count: (typeof existing.count === 'number' ? existing.count : 0) + 1,
          searchTerm: normalized,
        });
      } catch (updateErr) {
        console.error('updateSearchCount update failed:', updateErr);
      }
    } else {
      console.error('updateSearchCount create failed:', err);
    }
  }

  // Option B (your original list→update→create flow) — if you prefer that, ensure:
  // - Query.equal('searchTerm', [normalized])
  // - Unique index on searchTerm to avoid dupes in races
};

// --- Get trending movies from Appwrite or TMDB fallback ---
export const getTrendingMovies = async (limit = 5) => {
  // Try Appwrite first
  try {
    const result = await database.listDocuments(DATABASE_ID, COLLECTION_ID, [
      Query.orderDesc('count'), // requires an order index on 'count'
      Query.limit(limit),
    ]);

    if (result.documents.length > 0) {
      return result.documents.map((d) => ({
        ...d,
        title: d.title ?? d.searchTerm ?? 'Untitled',
        poster_url: d.poster_url ?? null,
      }));
    }
  } catch (err) {
    console.warn('Appwrite trending failed, will fallback to TMDB:', err);
  }

  // Fallback → TMDB trending if Appwrite has no docs or failed
  try {
    const response = await fetch(`${API_BASE_URL}/trending/movie/week`, {
      headers: TMDB_HEADERS,
    });
    if (!response.ok) {
      throw new Error(`TMDB trending fetch failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return (data.results || []).slice(0, limit).map((movie) => ({
      title: movie.title,
      poster_url: movie.poster_path
        ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
        : null,
      movie_id: movie.id,
    }));
  } catch (err) {
    console.error('TMDB fallback failed:', err);
    return [];
  }
};