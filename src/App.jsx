import { useEffect, useRef, useState } from 'react';
import Search from './components/Search.jsx';
import Spinner from './components/Spinner.jsx';
import MovieCard from './components/MovieCard.jsx';
import { getTrendingMovies, updateSearchCount } from './appwrite.js';

const API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_TOKEN = import.meta.env.VITE_TMDB_API_KEY;

const TMDB_HEADERS = {
  Authorization: `Bearer ${TMDB_TOKEN}`,
  Accept: 'application/json',
};

// how many trending items to show
const TRENDING_LIMIT = 10;

// Simple debounce hook
function useDebounce(value, delay = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const App = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [movieList, setMovieList] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [trendingMovies, setTrendingMovies] = useState([]);

  // Refs/state for trending scroller
  const trendingRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Results section ref for scroll-into-view
  const resultsRef = useRef(null);

  // Refs to prevent double-fetch when submitting via Enter + debounce
  const skipNextDebounceRef = useRef(false);
  const lastSubmittedRef = useRef('');

  // Fetch movies whenever debounced search term changes
  useEffect(() => {
    const q = (debouncedSearchTerm || '').trim();

    // If we just submitted via Enter, skip this duplicate call once
    if (skipNextDebounceRef.current && q === lastSubmittedRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }

    fetchMovies(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm]);

  // Fetch trending movies once on mount
  useEffect(() => {
    loadTrendingMovies();
  }, []);

  // Update arrow visibility on scroll/resize/data change
  useEffect(() => {
    const el = trendingRef.current;
    if (!el) return;

    const updateArrows = () => {
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft < maxScrollLeft - 1);
    };

    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);

    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [trendingMovies]);

  // Function to fetch movies (uses v4 token in Authorization header)
  const fetchMovies = async (query = '') => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const endpoint = query
        ? `${API_BASE_URL}/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`
        : `${API_BASE_URL}/discover/movie?sort_by=popularity.desc&include_adult=false&language=en-US&page=1`;

      const response = await fetch(endpoint, { headers: TMDB_HEADERS });

      if (!response.ok) {
        let detail = '';
        try {
          const errJson = await response.json();
          detail = errJson?.status_message || JSON.stringify(errJson);
        } catch {}
        throw new Error(`TMDB ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
      }

      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        setMovieList([]);
        setErrorMessage('No movies found');
        return;
      }

      setMovieList(data.results);

      if (query && data.results.length > 0) {
        await updateSearchCount(query, data.results[0]);
        // Refresh trending to reflect updated counts
        loadTrendingMovies();
      }
    } catch (error) {
      console.error('Error fetching movies:', error);
      setErrorMessage('Error fetching movies. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  // Function to load trending movies (loads 10)
  const loadTrendingMovies = async () => {
    try {
      const movies = await getTrendingMovies(TRENDING_LIMIT);
      setTrendingMovies(movies || []);
    } catch (error) {
      console.error('Error fetching trending movies:', error);
    }
  };

  // Smooth scroll the trending list by ~90% of the visible width
  const scrollTrending = (direction = 1) => {
    const el = trendingRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.9, 320); // at least one big card
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  };

  // Smooth scroll to results section
  const scrollToResults = () => {
    const el = resultsRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Submit handler for pressing Enter in the search bar
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const q = (searchTerm || '').trim();

    // Avoid double-fetch with debounce effect
    lastSubmittedRef.current = q;
    skipNextDebounceRef.current = true;

    // Scroll to results and fetch immediately
    scrollToResults();
    fetchMovies(q);
  };

  return (
    <main>
      <div className="pattern" />

      <div className="wrapper">
        <header>
          <img src="./hero.png" alt="Hero Banner" />
          <h1>
            Find <span className="text-gradient">Movies</span> You'll Enjoy Without the Hassle
          </h1>

          {/* Wrap Search with a form so Enter triggers onSubmit */}
          <form onSubmit={handleSearchSubmit}>
            <Search searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
          </form>
        </header>

        {trendingMovies.length > 0 && (
          <section className="trending relative">
            <h2>Trending Movies</h2>

            {/* Arrow: left (bigger, high-contrast, inside container) */}
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scrollTrending(-1)}
              disabled={!canScrollLeft}
              className="absolute left-2 top-1/2 z-30 -translate-y-1/2 grid place-items-center rounded-full bg-black/80 p-1.5 md:p-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.7)] ring-2 ring-white/70 backdrop-blur-sm hover:bg-black/90 hover:ring-white transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Arrow: right */}
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scrollTrending(1)}
              disabled={!canScrollRight}
              className="absolute right-2 top-1/2 z-30 -translate-y-1/2 grid place-items-center rounded-full bg-black/80 p-1.5 md:p-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.7)] ring-2 ring-white/70 backdrop-blur-sm hover:bg-black/90 hover:ring-white transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <ul ref={trendingRef}>
              {trendingMovies.map((movie, index) => (
                <li key={movie.$id || index}>
                  {/* If you don't want to show the rank number at all, remove this <p> */}
                  <p>{index + 1}</p>
                  {movie.poster_url && <img src={movie.poster_url} alt={movie.title} />}
                  <p className="title">{movie.title}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="all-movies" ref={resultsRef}>
          <h2>All Movies</h2>

          {isLoading ? (
            <Spinner />
          ) : errorMessage ? (
            <p className="text-red-500">{errorMessage}</p>
          ) : (
            <ul>
              {movieList.map((movie) => (
                <MovieCard key={movie.id} movie={movie} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
};

export default App;