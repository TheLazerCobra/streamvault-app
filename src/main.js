import './styles/main.css';
import { supabase, supabaseUrl, supabaseAnonKey } from './api/supabase.js';

var TMDB_PROXY = supabaseUrl + '/functions/v1/tmdb-proxy';
var IMGW    = 'https://image.tmdb.org/t/p/w500';
var IMGBIG  = 'https://image.tmdb.org/t/p/w1280';
var IMGFACE = 'https://image.tmdb.org/t/p/w185';
var IMGLOGO = 'https://image.tmdb.org/t/p/w92';
// Poster grid cards render at ~104-200px wide (see .poster-grid in
// main.css); w500 has up to ~2x more pixels than that ever needs, which
// means more bytes and more decode/raster cost per card, multiplied across
// every card on screen — a real contributor to scroll jank in a grid full
// of them. w342 is TMDB's closest standard size to that display width.
var IMGCARD = 'https://image.tmdb.org/t/p/w342';

var PLATFORMS = [
  // ── Special ──────────────────────────────────────────────────────────────
  {id:'all', label:'All Platforms',   color:'#e8b84b', short:'ALL'},
  // ── Major SVOD ───────────────────────────────────────────────────────────
  {id:8,     label:'Netflix',         color:'#e50914', short:'N'},
  {id:337,   label:'Disney+',         color:'#113ccf', short:'D+'},
  {id:9,     label:'Prime Video',     color:'#00a8e0', short:'PV'},
  {id:386,   label:'Peacock',         color:'#ff7800', short:'PC'},
  {id:15,    label:'Hulu',            color:'#1ce783', short:'H'},
  {id:350,   label:'Apple TV+',       color:'#a0a0a0', short:'A+'},
  {id:1899,  label:'Max',             color:'#002be7', short:'MAX'},
  {id:531,   label:'Paramount+',      color:'#0064ff', short:'P+'},
  // ── Pay Cable Add-ons ────────────────────────────────────────────────────
  {id:43,    label:'Starz',           color:'#5c6bc0', short:'STZ'},
  {id:289,   label:'MGM+',            color:'#1565c0', short:'MGM'},
  {id:526,   label:'AMC+',            color:'#c0392b', short:'AMC'},
  // ── Free / Ad-Supported ──────────────────────────────────────────────────
  {id:207,   label:'Tubi',            color:'#fa3c02', short:'TUBI'},
  {id:300,   label:'Pluto TV',        color:'#8e8e8e', short:'PLT'},
  {id:538,   label:'Plex',            color:'#e5a00d', short:'PLEX'},
  {id:613,   label:'Amazon Freevee',  color:'#007185', short:'FV'},
  // ── Niche / Genre ────────────────────────────────────────────────────────
  {id:283,   label:'Crunchyroll',     color:'#f47521', short:'CR'},
  {id:99,    label:'Shudder',         color:'#4caf50', short:'SHD'},
  {id:510,   label:'Discovery+',      color:'#0277bd', short:'DIS'},
  {id:151,   label:'BritBox',         color:'#d31f2a', short:'BB'},
  {id:11,    label:'Mubi',            color:'#9c27b0', short:'MUBI'},
];

var PLATFORM_URLS = {
  8:    'https://www.netflix.com',
  337:  'https://www.disneyplus.com',
  9:    'https://www.amazon.com/gp/video/storefront',
  386:  'https://www.peacocktv.com',
  15:   'https://www.hulu.com',
  350:  'https://tv.apple.com',
  1899: 'https://www.max.com',
  531:  'https://www.paramountplus.com',
  43:   'https://www.starz.com',
  289:  'https://www.mgmplus.com',
  526:  'https://www.amcplus.com',
  207:  'https://tubitv.com',
  300:  'https://pluto.tv',
  538:  'https://www.plex.tv',
  613:  'https://www.amazon.com/gp/video/storefront',
  283:  'https://www.crunchyroll.com',
  99:   'https://www.shudder.com',
  510:  'https://www.discoveryplus.com',
  151:  'https://www.britbox.com',
  11:   'https://mubi.com',
};

var GENRES_MOVIE = [
  {id:28,name:'Action'},{id:12,name:'Adventure'},{id:16,name:'Animation'},
  {id:35,name:'Comedy'},{id:80,name:'Crime'},{id:99,name:'Documentary'},
  {id:18,name:'Drama'},{id:'scifi-fantasy',name:'Sci-Fi & Fantasy'},{id:27,name:'Horror'},
  {id:10749,name:'Romance'},{id:53,name:'Thriller'},
];
var GENRES_TV = [
  {id:10759,name:'Action & Adv.'},{id:16,name:'Animation'},{id:35,name:'Comedy'},
  {id:80,name:'Crime'},{id:99,name:'Documentary'},{id:18,name:'Drama'},
  {id:27,name:'Horror'},{id:10764,name:'Reality'},{id:'scifi-fantasy',name:'Sci-Fi & Fantasy'},
  {id:10767,name:'Talk'},{id:10768,name:'War & Politics'},{id:37,name:'Western'},
];

var currentType    = 'all';
var authMode       = 'signin'; // 'signin' | 'signup'
var appStarted     = false;    // guards against re-running startup on token refresh
var _horrorKwId    = null; // cached TMDB keyword ID for "horror" — looked up once

// Look up the TMDB keyword ID for "horror" and cache it.
// Returns a Promise that resolves to the keyword ID string (e.g. "9327").
function getHorrorKeywordId() {
  if (_horrorKwId) return Promise.resolve(_horrorKwId);
  return apiCall('/search/keyword', {query: 'horror', page: 1}).then(function(data) {
    var results = data.results || [];
    // Find exact match for "horror" keyword
    var exact = results.filter(function(k) { return k.name.toLowerCase() === 'horror'; });
    // Use exact match if found, otherwise take the first result
    var kw = exact.length ? exact[0] : results[0];
    _horrorKwId = kw ? String(kw.id) : '185014'; // fallback to supernatural horror
    return _horrorKwId;
  }).catch(function() {
    _horrorKwId = '185014';
    return _horrorKwId;
  });
}
var activePlatform = []; // array of selected provider ids; empty = "All"
var activeGenre    = null;
var searchQuery    = '';
var searchTimer    = null;

// Filter state
var filters = {
  sort:        'popularity.desc',
  sortTv:      'popularity.desc',   // TV-compatible sort value (may differ from movie)
  clientSort:  null,                 // 'alpha.asc' | 'alpha.desc' | null
  sortMovieOnly: false,              // some sorts only apply to movies
  yearFrom:    '',
  yearTo:      '',
  rating:      '',
  votes:       '',
  language:    '',
};
var browseCurrentPage   = 1;
var browseCurrentGenre  = null;
var browseCurrentType   = 'all';
var browseCurrentPlatform = []; // array of selected provider ids; empty = "All"
var browseLoadingMore   = false;

// INIT
function init() {
  supabase.auth.onAuthStateChange(function(event, session) {
    if (session && !appStarted) {
      appStarted = true;
      loadProfileFromCloud().then(function() {
        document.getElementById('authGate').style.display = 'none';
        buildPlatformBar();
        buildGenreBar();
        loadHome();
      });
    } else if (!session) {
      appStarted = false;
      currentUserId = null;
      profile = { name: 'My Profile' };
      watched = {};
      lists = {};
      document.getElementById('authGate').style.display = 'flex';
    }
    // Any other combination (e.g. a background TOKEN_REFRESHED while the
    // app is already running) intentionally leaves the current view alone.
  });
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeModal();
      closeRatingModal();
      if (document.getElementById('profilePage').classList.contains('open')) closeProfile();
    }
  });
  // Allow Enter to save profile name
  document.getElementById('profileNameInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveProfileName();
  });
}

// AUTH
function toggleAuthMode() {
  authMode = (authMode === 'signin') ? 'signup' : 'signin';
  document.getElementById('authBtn').textContent = (authMode === 'signin') ? 'Sign In' : 'Sign Up';
  document.getElementById('authToggle').innerHTML = (authMode === 'signin')
    ? 'Don\u2019t have an account? <a href="#" onclick="toggleAuthMode();return false;">Sign up</a>'
    : 'Already have an account? <a href="#" onclick="toggleAuthMode();return false;">Sign in</a>';
  var errEl = document.getElementById('authError');
  errEl.style.color = '';
  errEl.textContent = '';
}

function submitAuth() {
  var email    = document.getElementById('authEmail').value.trim();
  var password = document.getElementById('authPassword').value;
  var errEl    = document.getElementById('authError');
  var btn      = document.getElementById('authBtn');
  var restoreLabel = (authMode === 'signin') ? 'Sign In' : 'Sign Up';

  errEl.style.color = '';
  if (!email || !password) { errEl.textContent = 'Enter both email and password.'; return; }

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Please wait\u2026';

  var action = (authMode === 'signin')
    ? supabase.auth.signInWithPassword({ email: email, password: password })
    : supabase.auth.signUp({ email: email, password: password });

  action.then(function(res) {
    if (res.error) {
      errEl.textContent = res.error.message;
      btn.disabled = false;
      btn.textContent = restoreLabel;
      return;
    }
    if (authMode === 'signup' && !res.data.session) {
      errEl.style.color = 'var(--gold)';
      errEl.textContent = 'Check your email to confirm your account, then sign in.';
      btn.disabled = false;
      btn.textContent = restoreLabel;
      return;
    }
    // onAuthStateChange (in init()) hides the gate and starts the app.
  }).catch(function(e) {
    errEl.textContent = 'Could not connect: ' + e.message;
    btn.disabled = false;
    btn.textContent = restoreLabel;
  });
}

function signOutUser() {
  supabase.auth.signOut();
}

// API HELPER \u2014 routes TMDB requests through the tmdb-proxy Edge Function,
// which holds the real TMDB key server-side, so the browser never needs one.
function apiCall(path, params) {
  var url = new URL(TMDB_PROXY + path);
  if (params) {
    Object.keys(params).forEach(function(pk) {
      url.searchParams.set(pk, params[pk]);
    });
  }
  return supabase.auth.getSession().then(function(res) {
    var session = res.data && res.data.session;
    var token = session ? session.access_token : supabaseAnonKey;
    return fetch(url.toString(), {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': supabaseAnonKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// PLATFORM BAR
function buildPlatformBar() {
  var bar = document.getElementById('platformBar');
  // Group separators: insert a divider before these IDs
  var groupStarts = {43:'Pay Cable', 207:'Free', 283:'Niche'};
  var html = '';
  PLATFORMS.forEach(function(p) {
    if (groupStarts[p.id]) {
      html += '<div class="platform-divider">' + groupStarts[p.id] + '</div>';
    }
    var isAll = p.id === 'all';
    var aStyle = isAll ? 'background:' + p.color + '1a;border-color:' + p.color + '66;color:' + p.color : '';
    var pidAttr = (typeof p.id === 'number') ? p.id : "'" + p.id + "'";
    html += '<button class="platform-chip' + (isAll ? ' active' : '') + '" data-pid="' + p.id + '" style="' + aStyle + '" onclick="selectPlatform(' + pidAttr + ')">'
      + '<div class="chip-dot" style="background:' + p.color + '"></div>' + p.label + '</button>';
  });
  bar.innerHTML = html;
}

function selectPlatform(id) {
  if (id === 'all') {
    activePlatform = [];
  } else {
    var idx = activePlatform.indexOf(id);
    if (idx === -1) activePlatform.push(id); else activePlatform.splice(idx, 1);
  }
  activeGenre = null;
  document.querySelectorAll('.platform-chip').forEach(function(c) {
    var pid = c.dataset.pid;
    var cid = pid === 'all' ? 'all' : parseInt(pid);
    var active = (cid === 'all') ? (activePlatform.length === 0) : (activePlatform.indexOf(cid) !== -1);
    c.classList.toggle('active', active);
    if (active) {
      var p = findPlatform(cid);
      if (p) {
        c.style.background  = p.color + (cid === 'all' ? '1a' : '22');
        c.style.borderColor = p.color + (cid === 'all' ? '66' : '77');
        c.style.color       = p.color;
      }
    } else {
      c.style.background = c.style.borderColor = c.style.color = '';
    }
  });
  buildGenreBar();
  if (activePlatform.length === 0) loadHome();
  else loadPlatformBrowse(activePlatform);
}

// ── Per-section Load More button helper ───────────────────────────────────────
// Inserts a smaller "Load More Movies" / "Load More TV Shows" button directly
// after the given section grid element, keyed by btnId so it can be replaced.
function makeSectionLoadMoreBtn(label, btnId, onClickFn) {
  var old = document.getElementById(btnId);
  if (old) old.parentNode.removeChild(old);
  var wrap = document.createElement('div');
  wrap.className = 'section-load-more';
  wrap.id = btnId;
  var btn = document.createElement('button');
  btn.className = 'section-load-more-btn';
  btn.textContent = label;
  btn.onclick = function() {
    btn.disabled = true;
    btn.textContent = 'Loading\u2026';
    onClickFn(btn);
  };
  wrap.appendChild(btn);
  return wrap;
}

// GENRE BAR
function buildGenreBar() {
  var bar = document.getElementById('genreBar');
  var genres;
  if (currentType === 'tv') genres = GENRES_TV;
  else if (currentType === 'movie') genres = GENRES_MOVIE;
  else {
    var seen = {};
    genres = [];
    GENRES_MOVIE.concat(GENRES_TV).forEach(function(g) {
      if (!seen[g.id]) { seen[g.id] = true; genres.push(g); }
    });
    genres.sort(function(a,b) { return a.name.localeCompare(b.name); });
  }
  var html = '<span class="genre-label">Genre</span>';
  html += '<button class="genre-pill' + (!activeGenre ? ' active' : '') + '" onclick="selectGenre(null,this)">All</button>';
  genres.forEach(function(g) {
    var idAttr = (typeof g.id === 'number') ? g.id : ("'" + g.id + "'");
    html += '<button class="genre-pill' + (activeGenre === g.id ? ' active' : '') + '" onclick="selectGenre(' + idAttr + ',this)">' + g.name + '</button>';
  });
  bar.innerHTML = html;
}

function selectGenre(id, btn) {
  activeGenre = id;
  document.querySelectorAll('.genre-pill').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  if (activePlatform.length > 0) loadPlatformBrowse(activePlatform);
  else if (id) loadAllPlatformsGenre(id, currentType);
  else loadHome();
}

// HOME
function loadHome() {
  browseCurrentPlatform = [];
  browseCurrentGenre    = null;
  browseCurrentType     = currentType;
  loadAllPlatformsBrowse(1);
}

// All Platforms, no genre filter — filterable, sortable, paginated
function loadAllPlatformsBrowse(page) {
  page = page || 1;
  browseCurrentPlatform = [];
  browseCurrentGenre    = null;
  browseCurrentType     = currentType;

  var main = document.getElementById('main');
  var pids = PLATFORMS.filter(function(p) { return p.id !== 'all'; }).map(function(p) { return p.id; });

  var filtersActive = currentType !== 'all' || filters.sort !== 'popularity.desc' || filters.clientSort ||
    filters.yearFrom || filters.yearTo || filters.rating || filters.votes || filters.language;

  if (!filtersActive && page === 1) {
    showFilterBar(true);
    main.innerHTML = skelShelves(3);
    Promise.all([
      apiCall('/trending/all/week', {language:'en-US'}),
      apiCall('/movie/now_playing', {language:'en-US', region:'US'}),
      apiCall('/tv/on_the_air',     {language:'en-US', page:1}),
    ]).then(function(results) {
      main.innerHTML = '';
      renderShelf(main, '\u2726 Trending This Week',            results[0].results, 'trending');
      renderShelf(main, '\uD83C\uDFAC In Theaters & Streaming', results[1].results, 'movie');
      renderShelf(main, '\uD83D\uDCFA New & Airing TV',          results[2].results, 'tv');
    }).catch(function(e) {
      main.innerHTML = emptyHTML('Could not load content', 'Check your API key and internet connection.');
    });
    return;
  }

  if (page === 1) { main.innerHTML = skelShelves(2); showFilterBar(true); }

  var extra = { with_watch_providers: pids.join('|'), page: page };
  var movieP = (currentType === 'tv')    ? Promise.resolve(null) : apiCall('/discover/movie', buildFilterParams(extra, 'movie'));
  var tvP    = (currentType === 'movie') ? Promise.resolve(null) : apiCall('/discover/tv',    buildFilterParams(extra, 'tv'));

  Promise.all([movieP, tvP]).then(function(results) {
    var md = results[0]; var td = results[1];
    var movies  = md ? clientSideSort(md.results, 'movie') : [];
    var shows   = td ? clientSideSort(td.results, 'tv')    : [];
    var totalMp = md ? md.total_pages   : 0; var totalTp = td ? td.total_pages   : 0;
    var totalMr = md ? md.total_results : 0; var totalTr = td ? td.total_results : 0;

    if (page === 1) {
      main.innerHTML = '';
      showFilterBar(true);
      main.appendChild(makeHeader('All Platforms', 'filtered results'));
      if (!movies.length && !shows.length) {
        main.innerHTML += emptyHTML('No titles match your filters', 'Try adjusting the filters above.');
        return;
      }
    }

    // ── Movies section ──────────────────────────────────────────────────────
    if (movies.length) {
      var omLM = document.getElementById('lm-movies'); if (omLM) omLM.parentNode.removeChild(omLM);
      if (page === 1) {
        var cb = document.createElement('div'); cb.className = 'result-count-bar';
        cb.textContent = totalMr.toLocaleString() + ' movies across all platforms'; main.appendChild(cb);
      }
      appendToGrid(main, 'movies-grid', '\uD83C\uDFAC Movies', movies, 'movie');
      if (page < totalMp) {
        var mGrid = document.getElementById('movies-grid'); var mp = page;
        var mBtn = makeSectionLoadMoreBtn('Load More Movies', 'lm-movies', function() { loadAllPlatformsBrowse(mp + 1); });
        if (mGrid && mGrid.parentNode) mGrid.parentNode.insertBefore(mBtn, mGrid.nextSibling);
        else main.appendChild(mBtn);
      }
    }

    // ── TV section ──────────────────────────────────────────────────────────
    if (shows.length) {
      var otLM = document.getElementById('lm-shows'); if (otLM) otLM.parentNode.removeChild(otLM);
      if (page === 1) {
        var cb2 = document.createElement('div'); cb2.className = 'result-count-bar'; cb2.style.marginTop = '24px';
        cb2.textContent = totalTr.toLocaleString() + ' TV shows across all platforms'; main.appendChild(cb2);
      }
      appendToGrid(main, 'shows-grid', '\uD83D\uDCFA TV Shows', shows, 'tv');
      if (page < totalTp) {
        var tGrid = document.getElementById('shows-grid'); var tp = page;
        var tBtn = makeSectionLoadMoreBtn('Load More TV Shows', 'lm-shows', function() { loadAllPlatformsBrowse(tp + 1); });
        if (tGrid && tGrid.parentNode) tGrid.parentNode.insertBefore(tBtn, tGrid.nextSibling);
        else main.appendChild(tBtn);
      }
    }
  }).catch(function(e) {
    if (page === 1) main.innerHTML = emptyHTML('Could not load', e.message);
  });
}

// PLATFORM BROWSE
// platformIds: array of selected provider ids (one or more). Multiple platforms
// are combined with OR logic — a title matches if it's available on ANY of them.
function loadPlatformBrowse(platformIds, page) {
  page = page || 1;
  browseCurrentPlatform = platformIds;
  browseCurrentGenre    = activeGenre;
  browseCurrentType     = currentType;

  var main        = document.getElementById('main');
  var providerStr = platformIds.join('|');
  var lbl         = platformIds.map(function(id) { var p = findPlatform(id); return p ? p.label : ''; }).filter(Boolean).join(' + ');

  if (page === 1) { main.innerHTML = skelShelves(2); showFilterBar(true); }

  var extraMovie = { with_watch_providers: providerStr, page: page };
  var extraTv    = { with_watch_providers: providerStr, page: page };
  if (activeGenre) { extraMovie.with_genres = resolveGenreId(activeGenre, 'movie'); extraTv.with_genres = resolveGenreId(activeGenre, 'tv'); }

  // Horror TV: TMDB does not have genre 27 for TV in its official list.
  // The correct approach is the TMDB "horror" keyword (looked up dynamically
  // via getHorrorKeywordId) which is how TMDB actually tags horror TV shows.
  // TMDB actually tags horror TV shows. GoT/HotD/DBZ do not have this keyword.
  // AHS, Walking Dead, From, Haunting of Hill House all do.
  var isHorrorTv = (activeGenre === 27 && currentType !== 'movie');

  var movieP = (currentType === 'tv') ? Promise.resolve(null) : apiCall('/discover/movie', buildFilterParams(extraMovie, 'movie'));

  var tvP = isHorrorTv
    ? getHorrorKeywordId().then(function(kwId) {
        return apiCall('/discover/tv', {
          language: 'en-US', watch_region: 'US',
          with_keywords: kwId,
          sort_by: 'vote_count.desc',
          with_watch_providers: providerStr,
          page: page
        });
      })
    : (currentType !== 'movie')
      ? apiCall('/discover/tv', buildFilterParams(extraTv, 'tv'))
      : Promise.resolve(null);

  Promise.all([movieP, tvP]).then(function(results) {
    var md = results[0]; var td = results[1];
    var rawMovies = md ? clientSideSort(md.results, 'movie') : [];
    var rawShows  = td ? clientSideSort(td.results, 'tv')    : [];
    var totalMp = md ? md.total_pages   : 0; var totalTp = td ? td.total_pages   : 0;
    var totalMr = md ? md.total_results : 0; var totalTr = td ? td.total_results : 0;

    if (page === 1) {
      main.innerHTML = '';
      showFilterBar(true);
      main.appendChild(makeHeader(lbl, activeGenre ? 'filtered by genre' : 'full catalog'));
      if (!rawMovies.length && !rawShows.length) { main.innerHTML += emptyHTML('Nothing found', 'Try adjusting your filters.'); return; }
    }

    // With one platform selected, the discover query already guarantees the
    // result set, so badges can be tagged directly. With several platforms
    // (OR logic), verify per-item which of the selected ones actually carry
    // it so badges stay accurate instead of showing every selected platform.
    var multi = platformIds.length > 1;
    var statusEl = null;
    if (multi && (rawMovies.length || rawShows.length)) {
      statusEl = document.createElement('div'); statusEl.className = 'status-bar'; statusEl.id = 'pstatus';
      statusEl.innerHTML = '<span class="spinning">↻</span> Checking streaming availability…';
      main.appendChild(statusEl);
    }

    var mReady = multi
      ? (rawMovies.length ? enrichWithProviders(rawMovies, 'movie', platformIds, false) : Promise.resolve([]))
      : Promise.resolve(rawMovies.map(function(i) { return Object.assign({}, i, {_pids: platformIds}); }));
    var tReady = multi
      ? (rawShows.length ? enrichWithProviders(rawShows, 'tv', platformIds, false) : Promise.resolve([]))
      : Promise.resolve(rawShows.map(function(i) { return Object.assign({}, i, {_pids: platformIds}); }));

    Promise.all([mReady, tReady]).then(function(ready) {
      if (statusEl) statusEl.remove();
      var movies = ready[0]; var shows = ready[1];

      // ── Movies section ──────────────────────────────────────────────────────
      if (movies.length) {
        var omLM = document.getElementById('lm-movies'); if (omLM) omLM.parentNode.removeChild(omLM);
        if (page === 1) {
          var cb = document.createElement('div'); cb.className = 'result-count-bar';
          cb.textContent = totalMr.toLocaleString() + ' movies'; main.appendChild(cb);
        }
        appendToGrid(main, 'movies-grid', '\uD83C\uDFAC Movies', movies, 'movie');
        if (page < totalMp) {
          var mGrid = document.getElementById('movies-grid'); var mp = page;
          var mBtn = makeSectionLoadMoreBtn('Load More Movies', 'lm-movies', function() { loadPlatformBrowse(platformIds, mp + 1); });
          if (mGrid && mGrid.parentNode) mGrid.parentNode.insertBefore(mBtn, mGrid.nextSibling);
          else main.appendChild(mBtn);
        }
      }

      // ── TV section ──────────────────────────────────────────────────────────
      if (shows.length) {
        var otLM = document.getElementById('lm-shows'); if (otLM) otLM.parentNode.removeChild(otLM);
        if (page === 1) {
          var cb2 = document.createElement('div'); cb2.className = 'result-count-bar'; cb2.style.marginTop = '24px';
          cb2.textContent = totalTr.toLocaleString() + ' TV shows'; main.appendChild(cb2);
        }
        appendToGrid(main, 'shows-grid', '\uD83D\uDCFA TV Shows', shows, 'tv');
        if (page < totalTp) {
          var tGrid = document.getElementById('shows-grid'); var tp = page;
          var tBtn = makeSectionLoadMoreBtn('Load More TV Shows', 'lm-shows', function() { loadPlatformBrowse(platformIds, tp + 1); });
          if (tGrid && tGrid.parentNode) tGrid.parentNode.insertBefore(tBtn, tGrid.nextSibling);
          else main.appendChild(tBtn);
        }
      }
    });
  }).catch(function(e) {
    if (page === 1) main.innerHTML = emptyHTML('Could not load', e.message);
  });
}

// Build discover API params with active filters applied
// SORT_OPTIONS: maps the selected sort key to movie and TV API values
// For client-side sorts (alphabetical), we fall back to popularity for the API
// and sort the received results ourselves before rendering.
var SORT_OPTIONS = {};  // populated by getSortMeta()

// Resolve genre sentinel IDs to actual TMDB API values.
// Horror (27) is valid for both movie and TV discover — TMDB does tag TV shows
// with genre 27, it's just not in their official UI list. Using it directly
// gives accurate results. We supplement with keywords in loadAllPlatformsGenre.
// ── Horror TV relevance scorer ────────────────────────────────────────────────
// Called client-side after fetching to re-rank results by how horror-relevant
// a show actually is. GoT scores low; Walking Dead, AHS, From score high.
// Returns a numeric score — higher = more horror.
function horrorRelevanceScore(item) {
  var score = 0;
  var genres = item.genre_ids || [];
  var desc   = ((item.overview || '') + ' ' + (item.name || item.title || '')).toLowerCase();

  // Genre signals
  if (genres.indexOf(27) !== -1)    score += 5;  // Has Horror genre — strong signal
  if (genres.indexOf(16) !== -1)    score -= 4;  // Animation (DBZ) — strong negative
  if (genres.indexOf(10762) !== -1) score -= 3;  // Kids
  // Sci-Fi & Fantasy without Horror drags down pure fantasy shows (GoT)
  if (genres.indexOf(10765) !== -1 && genres.indexOf(27) === -1) score -= 3;
  // Action & Adventure without Horror drags down pure action shows
  if (genres.indexOf(10759) !== -1 && genres.indexOf(27) === -1) score -= 2;

  // Description signals — words that strongly indicate horror content
  var horrorWords = [
    'terrif','horrif','horror','haunting','haunted','nightmare','nightmar',
    'creature','monster','zombie','undead','demon','supernatural','ghost',
    'sinister','macabre','dread','eerie','slasher','possessed','possession',
    'flesh-eating','bloodsucker','vampire','werewolf','witch','occult',
    'cult','murderous','stalker','suspense','frightening','terrifying'
  ];
  var wordScore = 0;
  horrorWords.forEach(function(w) { if (desc.indexOf(w) !== -1) wordScore++; });
  score += Math.min(wordScore, 4); // cap at +4 from description

  return score;
}

// Sort an array of TV shows by horror relevance score descending,
// using vote_count as a secondary tiebreaker within same score bands.
function sortByHorrorRelevance(items) {
  return items.slice().sort(function(a, b) {
    var sa = horrorRelevanceScore(a);
    var sb = horrorRelevanceScore(b);
    if (sb !== sa) return sb - sa;
    // Tiebreaker: vote_count so well-known shows beat obscure ones
    return (b.vote_count || 0) - (a.vote_count || 0);
  });
}

function resolveGenreId(id, mediaType) {
  if (id === 'scifi-fantasy') return '878|10765';
  return String(id);
}

function getSortMeta(optionEl) {
  // Returns { movieVal, tvVal, clientSort }
  // clientSort is 'alpha.asc' | 'alpha.desc' | null
  if (!optionEl) return { movieVal: filters.sort, tvVal: filters.sort, clientSort: null };
  return {
    movieVal:   optionEl.dataset.val  || 'popularity.desc',
    tvVal:      optionEl.dataset.tv   || optionEl.dataset.val || 'popularity.desc',
    clientSort: optionEl.dataset.client || null,
    movieOnly:  optionEl.dataset.movieOnly === '1',
  };
}

function buildFilterParams(extra, mediaType) {
  // mediaType: 'movie' | 'tv' | undefined (omit for generic)
  var sortVal = filters.sort;

  // If this is a TV request, use the TV-compatible sort value stored in filters.sortTv
  if (mediaType === 'tv' && filters.sortTv) {
    sortVal = filters.sortTv;
  }

  // If client-side sort is active, use popularity for the API request
  // (we'll re-sort the results ourselves)
  if (filters.clientSort) {
    sortVal = 'popularity.desc';
  }

  var p = Object.assign({language:'en-US', watch_region:'US', region:'US', sort_by: sortVal}, extra || {});
  if (filters.rating)   { p['vote_average.gte'] = filters.rating; }
  if (filters.votes)    { p['vote_count.gte']    = filters.votes; }
  if (filters.language) { p.with_original_language = filters.language; }

  // Date fields differ between movies and TV
  if (mediaType === 'tv') {
    if (filters.yearFrom) p['first_air_date.gte'] = filters.yearFrom + '-01-01';
    if (filters.yearTo)   p['first_air_date.lte'] = filters.yearTo   + '-12-31';
  } else {
    if (filters.yearFrom) p['primary_release_date.gte'] = filters.yearFrom + '-01-01';
    if (filters.yearTo)   p['primary_release_date.lte'] = filters.yearTo   + '-12-31';
  }
  return p;
}

// Apply client-side sort (alphabetical) to an array of items
function clientSideSort(items, type) {
  if (!filters.clientSort) return items;
  var sorted = items.slice();
  sorted.sort(function(a, b) {
    var titleA = (a.title || a.name || '').toLowerCase();
    var titleB = (b.title || b.name || '').toLowerCase();
    if (filters.clientSort === 'alpha.asc') return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
    return titleA > titleB ? -1 : titleA < titleB ? 1 : 0;
  });
  return sorted;
}

function showFilterBar(show) {
  var fb = document.getElementById('filterBar');
  if (show) fb.classList.remove('hidden'); else fb.classList.add('hidden');
}

function makeHeader(title, sub) {
  var div = document.createElement('div');
  div.innerHTML = '<div class="browse-header"><div class="browse-title">' + esc(title) + '</div><div class="browse-sub">' + esc(sub) + '</div></div>';
  return div;
}

// Append items to an existing grid or create a new titled shelf
function appendToGrid(container, gridId, title, items, type) {
  var existing = document.getElementById(gridId);
  if (existing) {
    items.forEach(function(item, i) {
      var card = buildCard(item, type, item._pids || null);
      card.style.animationDelay = Math.min(i * 15, 300) + 'ms';
      existing.appendChild(card);
    });
    return;
  }
  var shelf = document.createElement('div');
  shelf.className = 'shelf';
  var hdr = document.createElement('div'); hdr.className = 'shelf-header';
  var ht  = document.createElement('div'); ht.className  = 'shelf-title'; ht.innerHTML = title;
  hdr.appendChild(ht); shelf.appendChild(hdr);
  var grid = document.createElement('div');
  grid.className = 'poster-grid'; grid.id = gridId;
  items.forEach(function(item, i) {
    var card = buildCard(item, type, item._pids || null);
    card.style.animationDelay = Math.min(i * 20, 400) + 'ms';
    grid.appendChild(card);
  });
  shelf.appendChild(grid); container.appendChild(shelf);
}

// Enrich items with which of the user's platforms carry them
function enrichWithProviders(items, type, pids, strict) {
  // strict=true (default): filter out items not on any listed platform
  // strict=false: just attach _pids badge data, keep all items
  // Use strict=false when TMDB discover already filtered by with_watch_providers
  if (strict === undefined) strict = true;
  return Promise.all(items.map(function(item) {
    return apiCall('/' + type + '/' + item.id + '/watch/providers').then(function(data) {
      var us = (data.results && data.results.US) ? data.results.US : {};
      var flat = (us.flatrate || []).concat(us.free || []);
      var ids = flat.map(function(p) { return p.provider_id; }).filter(function(pid) { return pids.indexOf(pid) !== -1; });
      return Object.assign({}, item, {_pids: ids});
    }).catch(function() { return Object.assign({}, item, {_pids:[]}); });
  })).then(function(enriched) {
    return strict ? enriched.filter(function(i) { return i._pids.length > 0; }) : enriched;
  });
}

// ALL PLATFORMS + GENRE — unified paginated grid, no platform segmentation
function loadAllPlatformsGenre(genreId, typeFilter, page) {
  page = page || 1;
  browseCurrentGenre    = genreId;
  browseCurrentType     = typeFilter;
  browseCurrentPlatform = [];

  var main = document.getElementById('main');
  var pids = PLATFORMS.filter(function(p) { return p.id !== 'all'; }).map(function(p) { return p.id; });
  var genreName = '';
  GENRES_MOVIE.concat(GENRES_TV).forEach(function(g) { if (g.id === genreId) genreName = g.name; });

  if (page === 1) { main.innerHTML = skelShelves(2); showFilterBar(true); }

  var providerStr = pids.join('|');
  var extraMovie = { with_genres: resolveGenreId(genreId, 'movie'), with_watch_providers: providerStr, page: page };

  // Horror TV: use TMDB's "horror" keyword (looked up dynamically at runtime via
  // /search/keyword so we always use the correct ID, not a hardcoded guess).
  var isHorrorGenre = (genreId === 27);

  var movieP = (typeFilter === 'tv') ? Promise.resolve(null) : apiCall('/discover/movie', buildFilterParams(extraMovie, 'movie'));

  var tvP = (typeFilter === 'movie') ? Promise.resolve(null) :
    isHorrorGenre
      ? getHorrorKeywordId().then(function(kwId) {
          return apiCall('/discover/tv', {
            language: 'en-US', watch_region: 'US',
            with_keywords: kwId,
            sort_by: 'vote_count.desc',
            with_watch_providers: providerStr,
            page: page
          });
        })
      : apiCall('/discover/tv', buildFilterParams({ with_genres: resolveGenreId(genreId, 'tv'), with_watch_providers: providerStr, page: page }, 'tv'));

  Promise.all([movieP, tvP]).then(function(res) {
    var md = res[0]; var td = res[1];
    var movies = md ? clientSideSort(md.results, 'movie') : [];
    var shows  = td ? clientSideSort(td.results, 'tv')    : [];
    var totalMp = md ? md.total_pages   : 0; var totalTp = td ? td.total_pages   : 0;
    var totalMr = md ? md.total_results : 0; var totalTr = td ? td.total_results : 0;


    if (page === 1) { main.innerHTML = ''; showFilterBar(true); main.appendChild(makeHeader(genreName, 'across all your platforms')); }

    if (page === 1 && !movies.length && !shows.length) {
      main.innerHTML += emptyHTML('No ' + genreName + ' titles match your filters', 'Try adjusting the filters above.');
      return;
    }

    if (movies.length || shows.length) {
      var st = document.createElement('div'); st.className = 'status-bar'; st.id = 'pstatus';
      st.innerHTML = '<span class="spinning">\u21BB</span> Checking streaming availability\u2026';
      main.appendChild(st);
    }

    var mEnrich = movies.length ? enrichWithProviders(movies, 'movie', pids, false) : Promise.resolve([]);
    var tEnrich = shows.length  ? enrichWithProviders(shows,  'tv',    pids, false) : Promise.resolve([]);

    Promise.all([mEnrich, tEnrich]).then(function(enriched) {
      var ps = document.getElementById('pstatus'); if (ps) ps.remove();
      var em = enriched[0]; var es = enriched[1];

      // ── Movies section ────────────────────────────────────────────────────
      if (em.length) {
        var omLM = document.getElementById('lm-movies'); if (omLM) omLM.parentNode.removeChild(omLM);
        if (page === 1) {
          var cb = document.createElement('div'); cb.className = 'result-count-bar';
          cb.textContent = totalMr.toLocaleString() + ' movies available on your platforms'; main.appendChild(cb);
        }
        appendToGrid(main, 'movies-grid', '\uD83C\uDFAC Movies', em, 'movie');
        if (page < totalMp) {
          var mGrid = document.getElementById('movies-grid'); var mp = page;
          var mBtn = makeSectionLoadMoreBtn('Load More Movies', 'lm-movies', function() { loadAllPlatformsGenre(genreId, typeFilter, mp + 1); });
          if (mGrid && mGrid.parentNode) mGrid.parentNode.insertBefore(mBtn, mGrid.nextSibling);
          else main.appendChild(mBtn);
        }
      }

      // ── TV section ────────────────────────────────────────────────────────
      if (es.length) {
        var otLM = document.getElementById('lm-shows'); if (otLM) otLM.parentNode.removeChild(otLM);
        if (page === 1) {
          var cb2 = document.createElement('div'); cb2.className = 'result-count-bar'; cb2.style.marginTop = '24px';
          cb2.textContent = totalTr.toLocaleString() + ' TV shows available on your platforms'; main.appendChild(cb2);
        }
        appendToGrid(main, 'shows-grid', '\uD83D\uDCFA TV Shows', es, 'tv');
        if (page < totalTp) {
          var tGrid = document.getElementById('shows-grid'); var tp = page;
          var tBtn = makeSectionLoadMoreBtn('Load More TV Shows', 'lm-shows', function() { loadAllPlatformsGenre(genreId, typeFilter, tp + 1); });
          if (tGrid && tGrid.parentNode) tGrid.parentNode.insertBefore(tBtn, tGrid.nextSibling);
          else main.appendChild(tBtn);
        }
      }

      if (page === 1 && !main.querySelector('.poster-grid')) {
        main.innerHTML += emptyHTML('No titles on your platforms', genreName + ' exists but none are on your US subscriptions.');
      }
    }).catch(function(e) { var ps = document.getElementById('pstatus'); if (ps) ps.remove(); });
  }).catch(function(e) { if (page === 1) main.innerHTML = emptyHTML('Could not load', e.message); });
}


// ─── PROFILE SYSTEM ──────────────────────────────────────────────────────────
// In-memory state — populated from Postgres (loadProfileFromCloud, called
// on sign-in) and kept in sync with it. Every mutation below updates these
// objects immediately for a snappy UI, then writes through to Supabase in
// the background; a failed write shows a toast and reverts the local change.
var profile       = { name: 'My Profile' };
var currentUserId = null; // set by loadProfileFromCloud once signed in
var watched       = {};   // key -> { id, type, title, poster, year, rating, note, genreIds, tmdbScore, addedAt }
var lists         = {};   // listId -> { id, name, color, items: { key -> listItem } }
var activeProfileTab   = 'lists';
var activeListId       = null;  // null = showing overview, string = viewing a specific list
var profileSearchQ     = '';
var pendingRatingItem  = null;
var pendingRatingStar  = 0;
var _modalItems        = {};
var pendingPickerItem  = null;  // item waiting for list picker selection

// List colors
var LIST_COLORS = ['#e8b84b','#e85555','#4ade80','#60a5fa','#f47521','#a78bfa','#f472b6','#34d399','#fbbf24','#818cf8'];
var pendingEditListId  = null;   // null = creating new, string = editing existing
var pendingEditColor   = LIST_COLORS[0];
var pendingPickerAfterCreate = false; // re-open picker after creating list

// ── Cloud sync ───────────────────────────────────────────────────────────────
// listId -> Promise, present while that list's INSERT is still in flight, so
// an item added to a brand-new list doesn't race the list's own creation.
var pendingListCreates = {};

function afterListReady(listId, fn) {
  var pending = pendingListCreates[listId];
  return pending ? pending.then(fn) : fn();
}

function dbToListItem(row) {
  return {
    id: row.tmdb_id, type: row.media_type,
    title: row.title, poster: row.poster_path, year: row.year,
    seasons: row.seasons, genreIds: row.genre_ids || [],
    tmdbScore: row.tmdb_score,
    addedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
  };
}

// Called once, right after sign-in — replaces the placeholder in-memory
// state with the signed-in user's real data from Postgres.
function loadProfileFromCloud() {
  return supabase.auth.getUser().then(function(userRes) {
    var user = userRes.data && userRes.data.user;
    if (!user) return;
    currentUserId = user.id;
    return Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
      supabase.from('lists').select('id,name,color,list_items(tmdb_id,media_type,title,poster_path,year,seasons,genre_ids,tmdb_score,added_at)').eq('owner_id', user.id),
      supabase.from('watched').select('tmdb_id,media_type,title,poster_path,year,seasons,genre_ids,tmdb_score,rating,note,watched_at').eq('user_id', user.id),
    ]);
  }).then(function(results) {
    if (!results) return;
    var profileRes = results[0], listsRes = results[1], watchedRes = results[2];
    if (profileRes.error || listsRes.error || watchedRes.error) {
      throw (profileRes.error || listsRes.error || watchedRes.error);
    }

    profile.name = (profileRes.data && profileRes.data.display_name) || 'My Profile';

    lists = {};
    (listsRes.data || []).forEach(function(l) {
      var items = {};
      (l.list_items || []).forEach(function(li) {
        items[getItemKey(li.tmdb_id, li.media_type)] = dbToListItem(li);
      });
      lists[l.id] = { id: l.id, name: l.name, color: l.color, items: items };
    });

    watched = {};
    (watchedRes.data || []).forEach(function(w) {
      var entry = dbToListItem(w);
      entry.rating    = w.rating || 0;
      entry.note      = w.note || '';
      entry.watchedAt = w.watched_at ? new Date(w.watched_at).getTime() : Date.now();
      watched[getItemKey(w.tmdb_id, w.media_type)] = entry;
    });

    // First time this account has been seen — mirror the app's old default.
    if (!Object.keys(lists).length) createList('Want to Watch', '#e8b84b');

    updateProfileButton();
  }).catch(function(e) {
    showToast('Could not load your profile: ' + e.message);
  });
}

function getItemKey(id, type) { return type + '_' + id; }
function isWatched(id, type)   { return !!watched[getItemKey(id, type)]; }
function isInAnyList(id, type) {
  var key = getItemKey(id, type);
  return Object.values(lists).some(function(l) { return !!l.items[key]; });
}
function isWatchlist(id, type) { return isInAnyList(id, type); } // backward compat alias

function makeListItem(item, type) {
  return {
    id: item.id, type: type,
    title:  item.title || item.name || 'Untitled',
    poster: item.poster_path || null,
    year:   (item.release_date || item.first_air_date || '').slice(0,4),
    seasons: item.number_of_seasons || null,
    genreIds:  (item.genres || item.genre_ids || []).map(function(g) { return typeof g === 'object' ? g.id : g; }),
    tmdbScore: item.vote_average ? Math.floor(parseFloat(item.vote_average)) : null,
    addedAt: Date.now(),
  };
}

// ── List CRUD ─────────────────────────────────────────────────────────────────────
function createList(name, color) {
  var id = crypto.randomUUID();
  var row = {id:id, name:name || 'New List', color:color || LIST_COLORS[0], items:{}};
  lists[id] = row;

  pendingListCreates[id] = supabase.from('lists').insert({
    id: id, name: row.name, color: row.color,
  }).then(function(res) {
    delete pendingListCreates[id];
    if (res.error) {
      showToast('Could not save list: ' + res.error.message);
      delete lists[id];
      refreshProfileIfOpen();
    }
  });

  return id;
}

function renameList(listId, name, color) {
  if (!lists[listId]) return;
  var prevName = lists[listId].name, prevColor = lists[listId].color;
  lists[listId].name  = name  || lists[listId].name;
  lists[listId].color = color || lists[listId].color;

  afterListReady(listId, function() {
    return supabase.from('lists').update({ name: lists[listId].name, color: lists[listId].color }).eq('id', listId);
  }).then(function(res) {
    if (res && res.error) {
      showToast('Could not rename list: ' + res.error.message);
      if (lists[listId]) { lists[listId].name = prevName; lists[listId].color = prevColor; refreshProfileIfOpen(); }
    }
  });
}

function deleteList(listId) {
  var removed = lists[listId];
  delete lists[listId];
  if (activeListId === listId) { activeListId = null; }
  refreshProfileIfOpen();

  afterListReady(listId, function() {
    return supabase.from('lists').delete().eq('id', listId);
  }).then(function(res) {
    if (res && res.error) {
      showToast('Could not delete list: ' + res.error.message);
      if (removed) { lists[listId] = removed; refreshProfileIfOpen(); }
    }
  });
}

function addToList(listId, item, type) {
  if (!lists[listId]) return;
  var key = getItemKey(item.id, type);
  var entry = makeListItem(item, type);
  lists[listId].items[key] = entry;
  refreshModalButtons(item.id, type);
  refreshProfileIfOpen();
  showToast('\u2B50 Added to \u201C' + lists[listId].name + '\u201D');

  afterListReady(listId, function() {
    return supabase.from('list_items').upsert({
      list_id: listId, tmdb_id: item.id, media_type: type,
      title: entry.title, poster_path: entry.poster, year: entry.year,
      seasons: entry.seasons, genre_ids: entry.genreIds, tmdb_score: entry.tmdbScore,
    }, { onConflict: 'list_id,tmdb_id,media_type' });
  }).then(function(res) {
    if (res && res.error) {
      showToast('Could not save to list: ' + res.error.message);
      if (lists[listId]) { delete lists[listId].items[key]; refreshModalButtons(item.id, type); refreshProfileIfOpen(); }
    }
  });
}

function removeFromList(listId, id, type) {
  if (!lists[listId]) return;
  var key = getItemKey(id, type);
  var removed = lists[listId].items[key];
  delete lists[listId].items[key];
  refreshModalButtons(id, type);
  refreshProfileIfOpen();

  afterListReady(listId, function() {
    return supabase.from('list_items').delete().eq('list_id', listId).eq('tmdb_id', id).eq('media_type', type);
  }).then(function(res) {
    if (res && res.error) {
      showToast('Could not remove from list: ' + res.error.message);
      if (lists[listId] && removed) { lists[listId].items[key] = removed; refreshModalButtons(id, type); refreshProfileIfOpen(); }
    }
  });
}

function removeFromAllLists(id, type) {
  var key = getItemKey(id, type);
  Object.values(lists).forEach(function(l) { delete l.items[key]; });
  refreshModalButtons(id, type);
  refreshProfileIfOpen();

  supabase.from('list_items').delete().eq('tmdb_id', id).eq('media_type', type).then(function(res) {
    if (res && res.error) showToast('Could not remove from lists: ' + res.error.message);
  });
}

function listCountForItem(id, type) {
  var key = getItemKey(id, type);
  return Object.values(lists).filter(function(l) { return !!l.items[key]; }).length;
}

// ── Watched ───────────────────────────────────────────────────────────────────
function addToWatched(item, type, rating, note) {
  if (isInAnyList(item.id, type)) removeFromAllLists(item.id, type);
  var key = getItemKey(item.id, type);
  var entry = makeListItem(item, type);
  entry.rating    = rating || 0;
  entry.note      = note   || '';
  entry.watchedAt = Date.now();
  watched[key] = entry;
  refreshModalButtons(item.id, type);
  refreshProfileIfOpen();
  showToast('\u2714 Marked as Watched' + (rating ? ' \u2014 ' + rating + '\u2605' : ''));

  supabase.from('watched').upsert({
    tmdb_id: item.id, media_type: type, rating: entry.rating || null, note: entry.note || null,
    title: entry.title, poster_path: entry.poster, year: entry.year,
    seasons: entry.seasons, genre_ids: entry.genreIds, tmdb_score: entry.tmdbScore,
  }, { onConflict: 'user_id,tmdb_id,media_type' }).then(function(res) {
    if (res.error) {
      showToast('Could not save watch history: ' + res.error.message);
      delete watched[key];
      refreshModalButtons(item.id, type);
      refreshProfileIfOpen();
    }
  });
}

function removeFromWatched(id, type) {
  var key = getItemKey(id, type);
  var removed = watched[key];
  delete watched[key];
  refreshModalButtons(id, type);
  refreshProfileIfOpen();
  showToast('Removed from Watched');

  supabase.from('watched').delete().eq('tmdb_id', id).eq('media_type', type).then(function(res) {
    if (res.error) {
      showToast('Could not remove from watch history: ' + res.error.message);
      if (removed) { watched[key] = removed; refreshModalButtons(id, type); refreshProfileIfOpen(); }
    }
  });
}

// ── List picker modal ─────────────────────────────────────────────────────────
function openListPicker(id, type) {
  var cached = _modalItems[id];
  pendingPickerItem = { id:id, type:type, item: cached ? cached.item : {id:id} };
  renderListPickerItems();
  document.getElementById('listPickerModal').classList.add('open');
}

function closeListPicker() {
  document.getElementById('listPickerModal').classList.remove('open');
  pendingPickerItem = null;
}

function renderListPickerItems() {
  if (!pendingPickerItem) return;
  var key = getItemKey(pendingPickerItem.id, pendingPickerItem.type);
  var container = document.getElementById('listPickerItems');
  var html = '';
  Object.values(lists).forEach(function(lst) {
    var inList = !!lst.items[key];
    html += '<div class="list-picker-item' + (inList ? ' in-list' : '') + '" onclick="toggleListMembership(\'' + lst.id + '\')">'
      + '<div class="list-picker-dot" style="background:' + lst.color + '"></div>'
      + '<span class="list-picker-name">' + esc(lst.name) + '</span>'
      + '<span class="list-picker-cnt">' + Object.keys(lst.items).length + '</span>'
      + (inList ? '<span class="list-picker-check">\u2713</span>' : '')
      + '</div>';
  });
  container.innerHTML = html;
}

function toggleListMembership(listId) {
  if (!pendingPickerItem || !lists[listId]) return;
  var key = getItemKey(pendingPickerItem.id, pendingPickerItem.type);
  if (lists[listId].items[key]) {
    removeFromList(listId, pendingPickerItem.id, pendingPickerItem.type);
  } else {
    addToList(listId, pendingPickerItem.item, pendingPickerItem.type);
  }
  renderListPickerItems();  // refresh tick marks
  refreshModalButtons(pendingPickerItem.id, pendingPickerItem.type);
}

// ── New/Edit list modal ───────────────────────────────────────────────────────
var LIST_SWATCH_COLORS = ['#e8b84b','#e85555','#4ade80','#60a5fa','#f47521','#a78bfa','#f472b6','#34d399','#fbbf24','#38bdf8','#818cf8','#fb923c'];

function openNewListModal(listId, fromPicker) {
  pendingEditListId = listId || null;
  pendingPickerAfterCreate = !!fromPicker;
  pendingEditColor = listId ? (lists[listId] ? lists[listId].color : LIST_SWATCH_COLORS[0]) : LIST_SWATCH_COLORS[0];

  document.getElementById('listEditTitle').textContent = listId ? 'Edit List' : 'New List';
  document.getElementById('listEditName').value = listId && lists[listId] ? lists[listId].name : '';

  // Build color swatches
  var swatches = LIST_SWATCH_COLORS.map(function(c) {
    return '<div class="color-swatch' + (c === pendingEditColor ? ' selected' : '') + '" style="background:' + c + '" onclick="selectSwatch(this,\'' + c + '\')"></div>';
  }).join('');
  document.getElementById('colorSwatches').innerHTML = swatches;

  if (fromPicker) document.getElementById('listPickerModal').classList.remove('open');
  document.getElementById('listEditModal').classList.add('open');
  setTimeout(function() { document.getElementById('listEditName').focus(); }, 80);
}

function selectSwatch(el, color) {
  pendingEditColor = color;
  document.querySelectorAll('.color-swatch').forEach(function(s) { s.classList.remove('selected'); });
  el.classList.add('selected');
}

function closeListEditModal() {
  document.getElementById('listEditModal').classList.remove('open');
  if (pendingPickerAfterCreate && pendingPickerItem) {
    document.getElementById('listPickerModal').classList.add('open');
    renderListPickerItems();
  }
  pendingEditListId = null;
  pendingPickerAfterCreate = false;
}

function saveListEdit() {
  var name = (document.getElementById('listEditName').value || '').trim();
  if (!name) { document.getElementById('listEditName').focus(); return; }
  if (pendingEditListId) {
    renameList(pendingEditListId, name, pendingEditColor);
  } else {
    var newId = createList(name, pendingEditColor);
    // If opened from picker, also add the pending item to the new list
    if (pendingPickerAfterCreate && pendingPickerItem) {
      addToList(newId, pendingPickerItem.item, pendingPickerItem.type);
    }
  }
  document.getElementById('listEditModal').classList.remove('open');
  pendingPickerAfterCreate = false;
  if (pendingPickerItem) {
    document.getElementById('listPickerModal').classList.add('open');
    renderListPickerItems();
  }
  refreshProfileIfOpen();
}

// ── Profile header & navigation ───────────────────────────────────────────────
function updateProfileButton() {
  var nameEl   = document.getElementById('profileBtnLabel');
  var avatarSm = document.getElementById('profileAvatarSmall');
  var name = profile.name || 'My Profile';
  if (nameEl) nameEl.textContent = name;
  if (avatarSm) avatarSm.textContent = name.charAt(0).toUpperCase();
}

function openProfile() {
  document.getElementById('profilePage').classList.add('open');
  renderProfileHeader();
  showListsOverview();
}

function closeProfile() {
  document.getElementById('profilePage').classList.remove('open');
}

function refreshProfileIfOpen() {
  if (!document.getElementById('profilePage').classList.contains('open')) return;
  renderProfileHeader();
  renderProfileContent();
}

function renderProfileHeader() {
  var name = profile.name || 'My Profile';
  var nameText  = document.getElementById('profileNameText');
  var avatarLg  = document.getElementById('profileAvatarLg');
  var avatarSm  = document.getElementById('profileAvatarSmall');
  if (nameText) nameText.textContent = name;
  if (avatarLg) avatarLg.textContent = name.charAt(0).toUpperCase();
  if (avatarSm) avatarSm.textContent = name.charAt(0).toUpperCase();

  var watchedCount  = Object.keys(watched).length;
  var listCount     = Object.keys(lists).length;
  var totalListItems = Object.values(lists).reduce(function(s,l) { return s + Object.keys(l.items).length; }, 0);
  var ratedCount    = Object.values(watched).filter(function(w) { return w.rating > 0; }).length;
  var avgRating     = ratedCount
    ? (Object.values(watched).reduce(function(s,w) { return s + (w.rating||0); }, 0) / ratedCount).toFixed(1) : '\u2014';

  var statsEl = document.getElementById('profileStats');
  if (statsEl) statsEl.innerHTML =
    statPill(watchedCount,   'Watched') +
    statPill(totalListItems, 'Want to See') +
    statPill(listCount,      'Lists') +
    statPill(ratedCount,     'Rated');
}

function statPill(num, label) {
  return '<div class="stat-pill"><div class="stat-num">' + num + '</div><div class="stat-label">' + label + '</div></div>';
}

function editProfileName() {
  document.getElementById('profileNameInput').value = profile.name || '';
  document.getElementById('profileNameDisplay').style.display = 'none';
  document.getElementById('profileNameEdit').style.display = 'block';
  document.getElementById('profileNameInput').focus();
}

function saveProfileName() {
  var val = (document.getElementById('profileNameInput').value || '').trim();
  if (val) {
    var prev = profile.name;
    profile.name = val;
    renderProfileHeader();
    updateProfileButton();
    supabase.from('profiles').update({ display_name: val }).eq('id', currentUserId).then(function(res) {
      if (res.error) {
        showToast('Could not save name: ' + res.error.message);
        profile.name = prev;
        renderProfileHeader();
        updateProfileButton();
      }
    });
  }
  document.getElementById('profileNameDisplay').style.display = 'block';
  document.getElementById('profileNameEdit').style.display = 'none';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchProfileTab(tab, btn) {
  activeProfileTab = tab;
  document.querySelectorAll('.profile-tab').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  if (tab === 'lists') {
    showListsOverview();
  } else {
    activeListId = null;
    showToolbar(true);
    document.getElementById('listBackBtn').style.display = 'none';
    resetProfileFilters(true);
  }
}

function showToolbar(show) {
  var tb = document.getElementById('profileToolbar');
  if (tb) tb.style.display = show ? 'flex' : 'none';
}

function showListsOverview() {
  activeListId = null;
  showToolbar(false);
  document.getElementById('listBackBtn').style.display = 'none';
  profileSearchQ = '';
  renderProfileContent();
}

function openList(listId) {
  activeListId = listId;
  showToolbar(true);
  document.getElementById('listBackBtn').style.display = '';
  resetProfileFilters(true);
}

function resetProfileFilters(skipRender) {
  ['profileSearch','pfSort','pfType','pfGenre','pfDecade','pfScore'].forEach(function(id, i) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = ['','recent','all','all','all','all'][i];
  });
  profileSearchQ = '';
  renderProfileContent();
}

function applyProfileFilters() {
  profileSearchQ = (document.getElementById('profileSearch').value || '').toLowerCase();
  renderProfileContent();
}
function filterProfileList() { applyProfileFilters(); }

// ── Render profile content ────────────────────────────────────────────────────
function renderProfileContent() {
  var container = document.getElementById('profileContent');
  if (!container) return;

  if (activeProfileTab === 'lists') {
    if (activeListId) {
      renderListView(activeListId);
    } else {
      renderListsOverview();
    }
    return;
  }

  // Watched tab
  renderWatchedTab(container);
}

function renderListsOverview() {
  showToolbar(false);
  var container = document.getElementById('profileContent');
  var html = '<div class="lists-header">'
    + '<div style="font-family:Fraunces,serif;font-size:18px;font-weight:600;color:var(--text)">My Lists</div>'
    + '<button class="new-list-btn" onclick="openNewListModal(null,false)">&#43; New List</button>'
    + '</div>';
  var listArr = Object.values(lists);
  if (!listArr.length) {
    html += '<div class="profile-empty"><div class="profile-empty-icon">\uD83D\uDCCB</div>'
      + '<div class="profile-empty-text">No lists yet.<br>Create your first list to start organizing what you want to watch.</div></div>';
    container.innerHTML = html;
    return;
  }
  html += '<div class="lists-grid">';
  listArr.forEach(function(lst) {
    var count = Object.keys(lst.items).length;
    html += '<div class="list-card" style="--list-color:' + lst.color + '" onclick="openList(\'' + lst.id + '\')">'
      + '<div class="list-card-name">' + esc(lst.name) + '</div>'
      + '<div class="list-card-count">' + count + ' title' + (count === 1 ? '' : 's') + '</div>'
      + '<div class="list-card-actions" onclick="event.stopPropagation()">'
      + '<button class="list-action-btn" onclick="openNewListModal(\'' + lst.id + '\',false)">&#9998; Rename</button>'
      + '<button class="list-action-btn danger" onclick="confirmDeleteList(\'' + lst.id + '\')">&#10005; Delete</button>'
      + '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function confirmDeleteList(listId) {
  var lst = lists[listId];
  if (!lst) return;
  var count = Object.keys(lst.items).length;
  var msg = count
    ? 'Delete "' + lst.name + '"? This will remove ' + count + ' title' + (count===1?'':'s') + ' from this list.'
    : 'Delete "' + lst.name + '"?';
  if (confirm(msg)) deleteList(listId);
}

function renderListView(listId) {
  var lst = lists[listId];
  if (!lst) { showListsOverview(); return; }
  showToolbar(true);
  document.getElementById('listBackBtn').style.display = '';

  var sortVal   = (document.getElementById('pfSort')   || {value:'recent'}).value;
  var typeVal   = (document.getElementById('pfType')   || {value:'all'}).value;
  var genreVal  = (document.getElementById('pfGenre')  || {value:'all'}).value;
  var decadeVal = (document.getElementById('pfDecade') || {value:'all'}).value;
  var scoreVal  = (document.getElementById('pfScore')  || {value:'all'}).value;

  var selDefs = {pfSort:'recent',pfType:'all',pfGenre:'all',pfDecade:'all',pfScore:'all'};
  Object.keys(selDefs).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.className = 'pf-select' + (el.value !== selDefs[id] ? ' active' : '');
  });

  var anyActive = profileSearchQ || sortVal !== 'recent' || typeVal !== 'all' ||
    genreVal !== 'all' || decadeVal !== 'all' || scoreVal !== 'all';
  var rb = document.getElementById('pfResetBtn');
  if (rb) rb.style.display = anyActive ? 'inline-block' : 'none';

  var items = Object.values(lst.items);

  if (typeVal === 'movie') items = items.filter(function(i) { return i.type === 'movie'; });
  if (typeVal === 'tv')    items = items.filter(function(i) { return i.type === 'tv'; });
  if (genreVal !== 'all') {
    // Handle 'scifi-fantasy' sentinel: match either 878 (movie sci-fi) or 10765 (TV sci-fi/fantasy) or 14 (fantasy)
    // Horror (27) TV shows are tagged 10765 or 18; include all three for broad Horror matching
    var gids = genreVal === 'scifi-fantasy' ? [878, 10765, 14]
      : parseInt(genreVal) === 27 ? [27, 10765, 18]
      : [parseInt(genreVal)];
    items = items.filter(function(i) { return i.genreIds && gids.some(function(g) { return i.genreIds.indexOf(g) !== -1; }); });
  }
  if (decadeVal !== 'all') {
    var ds = parseInt(decadeVal);
    items = items.filter(function(i) {
      var y = parseInt(i.year); if (!y) return false;
      return decadeVal === '1970' ? y <= 1979 : (y >= ds && y <= ds + 9);
    });
  }
  if (scoreVal !== 'all') {
    var ms = parseInt(scoreVal);
    items = items.filter(function(i) { return i.tmdbScore && i.tmdbScore >= ms; });
  }
  if (profileSearchQ) {
    items = items.filter(function(i) { return i.title.toLowerCase().indexOf(profileSearchQ) !== -1; });
  }

  items.sort(function(a, b) {
    switch (sortVal) {
      case 'title':       return (a.title||'').toLowerCase() < (b.title||'').toLowerCase() ? -1 : 1;
      case 'title-desc':  return (a.title||'').toLowerCase() > (b.title||'').toLowerCase() ? -1 : 1;
      case 'year-desc':   return (b.year||'0') > (a.year||'0') ? 1 : -1;
      case 'year-asc':    return (a.year||'0') > (b.year||'0') ? 1 : -1;
      case 'rating-desc': return (b.rating||0) - (a.rating||0);
      case 'rating-asc':
        var ra=a.rating||0; var rb2=b.rating||0;
        if (!ra&&!rb2) return 0; if (!ra) return 1; if (!rb2) return -1; return ra-rb2;
      default: return (b.addedAt||0) - (a.addedAt||0);
    }
  });

  var total = Object.keys(lst.items).length;
  var countEl = document.getElementById('profileCount');
  if (countEl) countEl.textContent = items.length === total
    ? total + ' title' + (total===1?'':'s')
    : items.length + ' of ' + total;

  var container = document.getElementById('profileContent');
  container.innerHTML = '';

  // List header
  var lhdr = document.createElement('div');
  lhdr.className = 'viewing-list-name';
  lhdr.innerHTML = '<div class="list-color-dot" style="background:' + lst.color + '"></div>'
    + esc(lst.name);
  container.appendChild(lhdr);

  if (!items.length) {
    var eMsg = anyActive
      ? '<div class="profile-empty"><div class="profile-empty-icon">\uD83D\uDD0D</div><div class="profile-empty-text">No titles match your filters.</div></div>'
      : '<div class="profile-empty"><div class="profile-empty-icon">\uD83D\uDCCB</div><div class="profile-empty-text">This list is empty.<br>Add titles from any movie or TV show detail page.</div></div>';
    container.innerHTML += eMsg;
    return;
  }

  var grid = document.createElement('div');
  grid.className = 'profile-grid';
  items.forEach(function(entry, idx) {
    var card = buildProfileCard(entry, 'list', listId);
    card.style.animationDelay = Math.min(idx * 15, 300) + 'ms';
    card.style.animation = 'cardIn .3s ease both';
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

function renderWatchedTab(container) {
  var sortVal   = (document.getElementById('pfSort')   || {value:'recent'}).value;
  var typeVal   = (document.getElementById('pfType')   || {value:'all'}).value;
  var genreVal  = (document.getElementById('pfGenre')  || {value:'all'}).value;
  var decadeVal = (document.getElementById('pfDecade') || {value:'all'}).value;
  var scoreVal  = (document.getElementById('pfScore')  || {value:'all'}).value;

  var selDefs = {pfSort:'recent',pfType:'all',pfGenre:'all',pfDecade:'all',pfScore:'all'};
  Object.keys(selDefs).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.className = 'pf-select' + (el.value !== selDefs[id] ? ' active' : '');
  });

  var anyActive = profileSearchQ || sortVal !== 'recent' || typeVal !== 'all' ||
    genreVal !== 'all' || decadeVal !== 'all' || scoreVal !== 'all';
  var rb = document.getElementById('pfResetBtn');
  if (rb) rb.style.display = anyActive ? 'inline-block' : 'none';

  var items = Object.values(watched);
  if (typeVal === 'movie') items = items.filter(function(i) { return i.type === 'movie'; });
  if (typeVal === 'tv')    items = items.filter(function(i) { return i.type === 'tv'; });
  if (genreVal !== 'all') {
    // Handle 'scifi-fantasy' sentinel: match either 878 (movie sci-fi) or 10765 (TV sci-fi/fantasy) or 14 (fantasy)
    // Horror (27) TV shows are tagged 10765 or 18; include all three for broad Horror matching
    var gids = genreVal === 'scifi-fantasy' ? [878, 10765, 14]
      : parseInt(genreVal) === 27 ? [27, 10765, 18]
      : [parseInt(genreVal)];
    items = items.filter(function(i) { return i.genreIds && gids.some(function(g) { return i.genreIds.indexOf(g) !== -1; }); });
  }
  if (decadeVal !== 'all') {
    var ds = parseInt(decadeVal);
    items = items.filter(function(i) {
      var y = parseInt(i.year); if (!y) return false;
      return decadeVal === '1970' ? y <= 1979 : (y >= ds && y <= ds + 9);
    });
  }
  if (scoreVal !== 'all') {
    var ms = parseInt(scoreVal);
    items = items.filter(function(i) { return i.tmdbScore && i.tmdbScore >= ms; });
  }
  if (profileSearchQ) {
    items = items.filter(function(i) { return i.title.toLowerCase().indexOf(profileSearchQ) !== -1; });
  }

  items.sort(function(a, b) {
    switch (sortVal) {
      case 'title':       return (a.title||'').toLowerCase() < (b.title||'').toLowerCase() ? -1 : 1;
      case 'title-desc':  return (a.title||'').toLowerCase() > (b.title||'').toLowerCase() ? -1 : 1;
      case 'year-desc':   return (b.year||'0') > (a.year||'0') ? 1 : -1;
      case 'year-asc':    return (a.year||'0') > (b.year||'0') ? 1 : -1;
      case 'rating-desc': return (b.rating||0) - (a.rating||0);
      case 'rating-asc':
        var ra=a.rating||0; var rb2=b.rating||0;
        if (!ra&&!rb2) return 0; if (!ra) return 1; if (!rb2) return -1; return ra-rb2;
      default: return (b.addedAt||0) - (a.addedAt||0);
    }
  });

  var total = Object.keys(watched).length;
  var countEl = document.getElementById('profileCount');
  if (countEl) countEl.textContent = items.length === total
    ? total + ' title' + (total===1?'':'s') : items.length + ' of ' + total;

  if (!items.length) {
    var eMsg2 = anyActive
      ? 'No titles match your filters.'
      : 'No watched titles yet.<br>Open any movie or TV show and mark it as watched.';
    container.innerHTML = '<div class="profile-empty"><div class="profile-empty-icon">'
      + (anyActive ? '\uD83D\uDD0D' : '\u2714')
      + '</div><div class="profile-empty-text">' + eMsg2 + '</div></div>';
    return;
  }

  var grid = document.createElement('div');
  grid.className = 'profile-grid';
  items.forEach(function(entry, idx) {
    var card = buildProfileCard(entry, 'watched', null);
    card.style.animationDelay = Math.min(idx * 15, 300) + 'ms';
    card.style.animation = 'cardIn .3s ease both';
    grid.appendChild(card);
  });
  container.innerHTML = '';
  container.appendChild(grid);
}

function buildProfileCard(entry, cardType, listId) {
  var card = document.createElement('div');
  card.className = 'pcard';

  var posterHtml = entry.poster
    ? '<img class="pimg" src="' + IMGCARD + entry.poster + '" alt="' + esc(entry.title) + '" loading="lazy" decoding="async">'
    : '<div class="pplaceholder"><span class="ph-icon">\uD83C\uDFAC</span><span>' + esc(entry.title.substring(0,30)) + '</span></div>';

  var ratingHtml = (cardType === 'watched' && entry.rating)
    ? '<div class="rating-badge">\u2605 ' + entry.rating + '</div>' : '';
  var typeBadge = entry.type === 'tv' ? '<div class="type-badge">TV</div>' : '';
  var listBadge = cardType === 'watched'
    ? '<div class="pcard-list-badge badge-watched">\u2714 Watched</div>'
    : '<div class="pcard-list-badge badge-watchlist">\u2B50</div>';

  var metaParts = [];
  if (entry.year) metaParts.push(entry.year);
  if (entry.type === 'tv' && entry.seasons) metaParts.push(entry.seasons + (entry.seasons===1?' Season':' Seasons'));
  if (entry.tmdbScore) metaParts.push('\u2605 ' + entry.tmdbScore);

  card.innerHTML =
    '<div class="pframe">' + posterHtml + ratingHtml + typeBadge + listBadge +
    '<div class="poverlay"><div class="pplay">\u25B6</div></div></div>' +
    '<div class="ptitle">' + esc(entry.title) + '</div>' +
    '<div class="pmeta">' + (metaParts.join(' \u00B7 ') || '\u2014') + '</div>';

  if (cardType === 'watched' && entry.note) {
    var noteEl = document.createElement('div');
    noteEl.style.cssText = 'font-size:10px;color:var(--muted);margin-top:3px;font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden';
    noteEl.textContent = entry.note;
    card.appendChild(noteEl);
  }

  card.addEventListener('click', function() { openDetail(entry.id, entry.type); });
  return card;
}

// ── watchlist backward-compat shim ────────────────────────────────────────────
function addToWatchlist(item, type) { openListPicker(item.id, type); }
function removeFromWatchlist(id, type) { removeFromAllLists(id, type); showToast('Removed from lists'); }


// ── Rating modal ───────────────────────────────────────────────────────────
function openRatingModal(item, type) {
  pendingRatingItem = { item: item, type: type };
  var existing = watched[getItemKey(item.id, type)];
  pendingRatingStar = existing ? (existing.rating || 0) : 0;

  var isEditing = !!existing;
  document.getElementById('ratingModalTitle').textContent = item.title || item.name || 'Rate this';
  document.getElementById('ratingModalSub').textContent   = isEditing ? 'Edit your review' : 'How would you rate it?';
  document.getElementById('ratingNote').value             = existing ? (existing.note || '') : '';
  document.getElementById('ratingRemoveBtn').style.display = isEditing ? 'block' : 'none';
  updateRatingStarsUI(pendingRatingStar);
  document.getElementById('ratingModal').classList.add('open');
}

function removeAndCloseRating() {
  if (!pendingRatingItem) return;
  removeFromWatched(pendingRatingItem.item.id, pendingRatingItem.type);
  closeRatingModal();
}

function closeRatingModal() {
  document.getElementById('ratingModal').classList.remove('open');
  pendingRatingItem = null;
  pendingRatingStar = 0;
}

function setRatingStar(val) {
  pendingRatingStar = val;
  updateRatingStarsUI(val);
}

function previewStar(val) {
  // On hover show preview; on mouseout revert to selected value
  updateRatingStarsUI(val || pendingRatingStar);
}

function updateRatingStarsUI(val) {
  document.querySelectorAll('#ratingStars .star').forEach(function(s, i) {
    s.classList.toggle('lit', i < val);
  });
}

function saveRating() {
  if (!pendingRatingItem) return;
  var note = document.getElementById('ratingNote').value.trim();
  addToWatched(pendingRatingItem.item, pendingRatingItem.type, pendingRatingStar, note);
  closeRatingModal();
}

// ── Refresh modal action buttons without re-opening the modal ──────────────
function refreshModalButtons(id, type) {
  var btnWatched   = document.getElementById('maction-watched-'   + id);
  var btnWatchlist = document.getElementById('maction-watchlist-' + id);
  if (btnWatched) {
    var w = isWatched(id, type);
    btnWatched.className = 'maction-btn' + (w ? ' watched' : '');
    btnWatched.textContent = w ? '\u2714 Watched' : '\uD83D\uDC41 Mark as Watched';
  }
  if (btnWatchlist) {
    var count = listCountForItem(id, type);
    btnWatchlist.className = 'maction-btn' + (count > 0 ? ' watchlist' : '');
    btnWatchlist.textContent = count > 0
      ? '\u2B50 In ' + count + (count === 1 ? ' List' : ' Lists')
      : '+ Add to List';
  }
}

// ── Modal button click handlers — item looked up from cache by id
function handleWatchedClick(id, type) {
  var cached = _modalItems[id];
  var item   = cached ? cached.item : {id:id};
  openRatingModal(item, type);
}

function handleWatchlistClick(id, type) {
  // Always open list picker — user can add/remove from individual lists there
  openListPicker(id, type);
}

// FILTER FUNCTIONS
function toggleDropdown(name) {
  var dd   = document.getElementById('dd-' + name);
  var btn  = dd.previousElementSibling;
  var isOpen = dd.style.display !== 'none';
  // Close all dropdowns first
  document.querySelectorAll('.filter-dropdown').forEach(function(d) { d.style.display = 'none'; });
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('open'); });
  if (!isOpen) { dd.style.display = 'block'; btn.classList.add('open'); }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.filter-group')) {
    document.querySelectorAll('.filter-dropdown').forEach(function(d) { d.style.display = 'none'; });
    document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('open'); });
  }
});

function markFilterActive(btnId, active) {
  var btn = document.querySelector('#fg-' + btnId + ' .filter-btn');
  if (btn) btn.classList.toggle('active', active);
  updateResetBtn();
}

function updateResetBtn() {
  var anyActive = filters.sort !== 'popularity.desc' || filters.clientSort || filters.yearFrom || filters.yearTo || filters.rating || filters.votes || filters.language;
  var rb = document.getElementById('filterResetBtn');
  if (rb) rb.style.display = anyActive ? 'inline-block' : 'none';
}

function setSortOption(el, label) {
  document.querySelectorAll('#dd-sort .dd-option').forEach(function(o) { o.classList.remove('selected'); o.querySelector('.dd-check').textContent = ''; });
  el.classList.add('selected'); el.querySelector('.dd-check').textContent = '\u2713';

  var meta = getSortMeta(el);
  filters.sort       = meta.movieVal;
  filters.sortTv     = meta.tvVal;
  filters.clientSort = meta.clientSort;
  filters.sortMovieOnly = meta.movieOnly;

  // Show movie-only note in label if applicable
  var displayLabel = label;
  if (meta.movieOnly) displayLabel = label + ' *';

  document.getElementById('sort-label').textContent = displayLabel;
  document.getElementById('dd-sort').style.display = 'none';
  document.querySelector('#fg-sort .filter-btn').classList.remove('open');
  markFilterActive('sort', filters.sort !== 'popularity.desc' || filters.clientSort);
  applyFilters();
}

function updateRangeLabel(id, val) {
  document.getElementById(id).textContent = val;
}

function applyYearFilter() {
  var from = document.getElementById('year-from').value;
  var to   = document.getElementById('year-to').value;
  filters.yearFrom = from;
  filters.yearTo   = to;
  var lbl = from + '\u2013' + to;
  document.getElementById('year-label').textContent = ': ' + lbl;
  document.getElementById('dd-year').style.display = 'none';
  document.querySelector('#fg-year .filter-btn').classList.remove('open');
  markFilterActive('year', true);
  applyFilters();
}

function setRatingOption(el, val, label) {
  document.querySelectorAll('#dd-rating .dd-option').forEach(function(o) { o.classList.remove('selected'); o.querySelector('.dd-check').textContent = ''; });
  el.classList.add('selected'); el.querySelector('.dd-check').textContent = '\u2713';
  filters.rating = val;
  document.getElementById('rating-label').textContent = label ? ': ' + label : '';
  document.getElementById('dd-rating').style.display = 'none';
  document.querySelector('#fg-rating .filter-btn').classList.remove('open');
  markFilterActive('rating', !!val);
  applyFilters();
}

function setVotesOption(el, val, label) {
  document.querySelectorAll('#dd-votes .dd-option').forEach(function(o) { o.classList.remove('selected'); o.querySelector('.dd-check').textContent = ''; });
  el.classList.add('selected'); el.querySelector('.dd-check').textContent = '\u2713';
  filters.votes = val;
  document.getElementById('votes-label').textContent = label ? ': ' + label : '';
  document.getElementById('dd-votes').style.display = 'none';
  document.querySelector('#fg-votes .filter-btn').classList.remove('open');
  markFilterActive('votes', !!val);
  applyFilters();
}

function setLangOption(el, val, label) {
  document.querySelectorAll('#dd-lang .dd-option').forEach(function(o) { o.classList.remove('selected'); o.querySelector('.dd-check').textContent = ''; });
  el.classList.add('selected'); el.querySelector('.dd-check').textContent = '\u2713';
  filters.language = val;
  document.getElementById('lang-label').textContent = label ? ': ' + label : '';
  document.getElementById('dd-lang').style.display = 'none';
  document.querySelector('#fg-lang .filter-btn').classList.remove('open');
  markFilterActive('lang', !!val);
  applyFilters();
}

function applyFilters() {
  if (browseCurrentPlatform.length > 0) {
    loadPlatformBrowse(browseCurrentPlatform, 1);
  } else if (browseCurrentGenre) {
    loadAllPlatformsGenre(browseCurrentGenre, browseCurrentType, 1);
  } else {
    // All Platforms, no genre — re-run the home/discover view
    loadAllPlatformsBrowse(1);
  }
}

function resetFilters() {
  filters.sort = 'popularity.desc'; filters.sortTv = 'popularity.desc';
  filters.clientSort = null; filters.sortMovieOnly = false;
  filters.yearFrom = ''; filters.yearTo = '';
  filters.rating = ''; filters.votes = ''; filters.language = '';
  // Reset UI labels
  document.getElementById('sort-label').textContent    = 'Popularity';
  document.getElementById('year-label').textContent    = '';
  document.getElementById('rating-label').textContent  = '';
  document.getElementById('votes-label').textContent   = '';
  document.getElementById('lang-label').textContent    = '';
  // Reset year sliders
  document.getElementById('year-from').value = '1990';
  document.getElementById('year-to').value   = '2025';
  document.getElementById('year-from-val').textContent = '1990';
  document.getElementById('year-to-val').textContent   = '2025';
  // Reset all selected states
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.dd-option').forEach(function(o) { o.classList.remove('selected'); o.querySelector('.dd-check').textContent = ''; });
  // Re-select defaults
  var defSort = document.querySelector('#dd-sort .dd-option[data-val="popularity.desc"]');
  if (defSort) { defSort.classList.add('selected'); defSort.querySelector('.dd-check').textContent = '\u2713'; }
  var defVotes = document.querySelector('#dd-votes .dd-option[data-val=""]');
  if (defVotes) { defVotes.classList.add('selected'); defVotes.querySelector('.dd-check').textContent = '\u2713'; }
  document.getElementById('filterResetBtn').style.display = 'none';
  applyFilters();
}

// SEARCH
function handleSearch(e) {
  var q = e.target.value.trim();
  searchQuery = q;
  document.getElementById('searchClear').classList.toggle('vis', q.length > 0);
  clearTimeout(searchTimer);
  if (!q) {
    buildGenreBar();
    if (activePlatform.length > 0) loadPlatformBrowse(activePlatform);
    else if (activeGenre) loadAllPlatformsGenre(activeGenre, currentType);
    else loadHome();
    return;
  }
  searchTimer = setTimeout(function() { runSearch(q); }, 380);
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  searchQuery = '';
  document.getElementById('searchClear').classList.remove('vis');
  buildGenreBar();
  if (activePlatform.length > 0) loadPlatformBrowse(activePlatform);
  else if (activeGenre) loadAllPlatformsGenre(activeGenre, currentType);
  else loadHome();
}

// ── Smart Query Parser ───────────────────────────────────────────────────────
// Maps common concept words to TMDB genre IDs and keyword IDs
var CONCEPT_MAP = {
  // Genre words -> TMDB genre IDs
  'action':       {genres:[28,10759]},
  'adventure':    {genres:[12,10759]},
  'animated':     {genres:[16]},
  'animation':    {genres:[16]},
  'cartoon':      {genres:[16]},
  'comedy':       {genres:[35]},
  'funny':        {genres:[35]},
  'humor':        {genres:[35]},
  'humour':       {genres:[35]},
  'crime':        {genres:[80]},
  'gangster':     {genres:[80]},
  'documentary':  {genres:[99]},
  'docuseries':   {genres:[99]},
  'drama':        {genres:[18]},
  'dramatic':     {genres:[18]},
  'fantasy':      {genres:[14,10765]},
  'horror':       {genres:[27]},
  'scary':        {genres:[27]},
  'thriller':     {genres:[53]},
  'suspense':     {genres:[53]},
  'romance':      {genres:[10749]},
  'romantic':     {genres:[10749]},
  'love':         {genres:[10749]},
  'scifi':        {genres:[878,10765]},
  'sci-fi':       {genres:[878,10765]},
  'science fiction': {genres:[878,10765]},
  'mystery':      {genres:[9648]},
  'war':          {genres:[10768,10752]},
  'western':      {genres:[37]},
  'reality':      {genres:[10764]},
  'reality tv':   {genres:[10764]},
  'talk show':    {genres:[10767]},
  'kids':         {genres:[10762,16]},
  'family':       {genres:[10751]},
  // Theme keywords -> TMDB keyword search terms
  'superhero':    {keywords:['superhero']},
  'superheroes':  {keywords:['superhero']},
  'marvel':       {keywords:['marvel cinematic universe','superhero']},
  'dc':           {keywords:['dc comics','superhero']},
  'zombie':       {keywords:['zombie','zombies']},
  'zombies':      {keywords:['zombie']},
  'vampire':      {keywords:['vampire']},
  'vampires':     {keywords:['vampire']},
  'time travel':  {keywords:['time travel']},
  'space':        {keywords:['space','outer space'],genres:[878,10765]},
  'alien':        {keywords:['alien','extraterrestrial'],genres:[878]},
  'aliens':       {keywords:['alien'],genres:[878]},
  'dystopia':     {keywords:['dystopia','post-apocalyptic']},
  'dystopian':    {keywords:['dystopia']},
  'apocalypse':   {keywords:['apocalypse','post-apocalyptic']},
  'apocalyptic':  {keywords:['apocalypse']},
  'heist':        {keywords:['heist']},
  'spy':          {keywords:['spy','espionage']},
  'espionage':    {keywords:['espionage']},
  'based on true story': {keywords:['based on a true story']},
  'true story':   {keywords:['based on a true story']},
  'biography':    {keywords:['biography']},
  'biopic':       {keywords:['biography']},
  'serial killer':{keywords:['serial killer']},
  'murder':       {keywords:['murder','murder mystery']},
  'detective':    {keywords:['detective']},
  'courtroom':    {keywords:['courtroom']},
  'legal':        {keywords:['law']},
  'medical':      {keywords:['hospital','doctor']},
  'sports':       {keywords:['sport']},
  'music':        {keywords:['music','musician']},
  'martial arts': {keywords:['martial arts']},
  'kung fu':      {keywords:['kung fu','martial arts']},
  'anime':        {keywords:['anime'],genres:[16]},
  'based on book':{keywords:['based on novel','based on book']},
  'fairy tale':   {keywords:['fairy tale']},
  'satire':       {keywords:['satire']},
  'dark comedy':  {keywords:['dark comedy','black comedy'],genres:[35]},
  'psychological':{keywords:['psychological thriller'],genres:[53]},
  'coming of age':{keywords:['coming of age']},
  'high school':  {keywords:['high school']},
  'college':      {keywords:['college']},
  'road trip':    {keywords:['road trip']},
  'survival':     {keywords:['survival']},
  'disaster':     {keywords:['disaster']},
  'haunted':      {keywords:['haunted house','ghost'],genres:[27]},
  'ghost':        {keywords:['ghost'],genres:[27]},
  'witches':      {keywords:['witch']},
  'magic':        {keywords:['magic']},
  'dragon':       {keywords:['dragon']},
  'pirate':       {keywords:['pirate']},
  'robot':        {keywords:['robot','artificial intelligence']},
  'ai':           {keywords:['artificial intelligence']},
  'virtual reality': {keywords:['virtual reality']},
  'social media': {keywords:['social media']},
  'politics':     {keywords:['politics'],genres:[10768]},
  'political':    {keywords:['politics'],genres:[10768]},
  'historical':   {keywords:['history','historical fiction']},
  'period':       {keywords:['period drama']},
  'world war':    {keywords:['world war ii','world war i'],genres:[10752]},
  'ww2':          {keywords:['world war ii'],genres:[10752]},
  'cold war':     {keywords:['cold war']},
  'true crime':   {keywords:['true crime']},
  'nature':       {keywords:['nature'],genres:[99]},
  'ocean':        {keywords:['ocean','sea']},
  'wild west':    {keywords:['western'],genres:[37]},
  'ninja':        {keywords:['ninja']},
  'holiday':      {keywords:['christmas','holiday']},
  'christmas':    {keywords:['christmas']},
  'halloween':    {keywords:['halloween']},
  'cooking':      {keywords:['cooking','chef']},
  'food':         {keywords:['food']},
  'travel':       {keywords:['travel']},
};

// Time modifier words -> approximate year logic
var TIME_MODIFIERS = {
  'old':      function(y) { return y <= new Date().getFullYear() - 20; },
  'classic':  function(y) { return y <= new Date().getFullYear() - 25; },
  'vintage':  function(y) { return y <= new Date().getFullYear() - 30; },
  'retro':    function(y) { return y <= new Date().getFullYear() - 25; },
  'new':      function(y) { return y >= new Date().getFullYear() - 3; },
  'recent':   function(y) { return y >= new Date().getFullYear() - 5; },
  'modern':   function(y) { return y >= 2000; },
  'latest':   function(y) { return y >= new Date().getFullYear() - 2; },
  '2020s':    function(y) { return y >= 2020; },
  '2010s':    function(y) { return y >= 2010 && y < 2020; },
  '2000s':    function(y) { return y >= 2000 && y < 2010; },
  '90s':      function(y) { return y >= 1990 && y < 2000; },
  '1990s':    function(y) { return y >= 1990 && y < 2000; },
  '80s':      function(y) { return y >= 1980 && y < 1990; },
  '1980s':    function(y) { return y >= 1980 && y < 1990; },
  '70s':      function(y) { return y >= 1970 && y < 1980; },
  '1970s':    function(y) { return y >= 1970 && y < 1980; },
};

// Parse a query and return intent: {genres, keywordTerms, yearTest, typeHint, remainder, isConcept}
function parseSearchQuery(raw) {
  var q    = raw.toLowerCase().trim();
  var genres = [];
  var keywordTerms = [];
  var yearTest = null;
  var typeHint = null;

  // Detect type hints
  if (/\b(movie|film|movies|films|cinema)\b/.test(q)) typeHint = 'movie';
  if (/\b(tv|show|shows|series|episode|episodes)\b/.test(q)) typeHint = 'tv';

  // Detect time modifiers (longest match first)
  var timeKeys = Object.keys(TIME_MODIFIERS).sort(function(a,b) { return b.length - a.length; });
  timeKeys.forEach(function(mod) {
    if (q.indexOf(mod) !== -1) {
      if (!yearTest) yearTest = TIME_MODIFIERS[mod];
    }
  });

  // Match concepts (longest phrase first to avoid partial matches)
  var conceptKeys = Object.keys(CONCEPT_MAP).sort(function(a,b) { return b.length - a.length; });
  var matched = false;
  conceptKeys.forEach(function(key) {
    if (q.indexOf(key) !== -1) {
      var c = CONCEPT_MAP[key];
      if (c.genres)   c.genres.forEach(function(g) { if (genres.indexOf(g) === -1) genres.push(g); });
      if (c.keywords) c.keywords.forEach(function(k) { if (keywordTerms.indexOf(k) === -1) keywordTerms.push(k); });
      matched = true;
    }
  });

  // Remove modifiers/concepts from remainder to see if a title name is left
  var remainder = q;
  timeKeys.forEach(function(mod) { remainder = remainder.replace(new RegExp('\\b' + mod.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b','gi'),''); });
  conceptKeys.forEach(function(key) { remainder = remainder.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),''); });
  // Remove type hints
  remainder = remainder.replace(/\b(movie|film|movies|films|cinema|tv|show|shows|series)\b/gi,'');
  remainder = remainder.replace(/\s+/g,' ').trim();

  return {
    genres:       genres,
    keywordTerms: keywordTerms,
    yearTest:     yearTest,
    typeHint:     typeHint,
    remainder:    remainder,          // any leftover text (could be a title/name fragment)
    isConcept:    matched || !!yearTest,
  };
}

// Smart search: combines concept discovery + traditional title/person search
// Search state stored for Load More to reuse
var _searchState = null;

function runSearch(q, page) {
  page = page || 1;
  showFilterBar(false);
  var main = document.getElementById('main');

  if (page === 1) {
    main.innerHTML = skelShelves(2);
    _searchState = null; // reset on fresh search
  } else {
    // Remove per-section load more buttons so they get re-inserted after new cards
    ['lm-search-movies','lm-search-shows'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.parentNode.removeChild(el);
    });
  }

  var intent = page === 1 ? parseSearchQuery(q) : _searchState.intent;
  var effectiveType = intent.typeHint || (currentType !== 'all' ? currentType : null);

  // ── Keyword lookup (page 1 only — cache for subsequent pages) ────────────
  function getKwIds() {
    if (_searchState && _searchState.kwIds !== undefined) {
      return Promise.resolve(_searchState.kwIds);
    }
    if (!intent.keywordTerms.length) return Promise.resolve([]);
    return Promise.all(intent.keywordTerms.slice(0,3).map(function(kw) {
      return apiCall('/search/keyword', {query:kw, page:1});
    })).then(function(kwResults) {
      var kwIds = [];
      kwResults.forEach(function(r) {
        if (r && r.results) r.results.slice(0,3).forEach(function(k) { kwIds.push(k.id); });
      });
      return kwIds;
    });
  }

  // ── Build discover base params (only computed once) ───────────────────────
  function getDiscoverBase() {
    if (_searchState && _searchState.discoverBase) return _searchState.discoverBase;
    var base = {
      language:'en-US', watch_region:'US', sort_by:'popularity.desc',
      with_watch_providers: PLATFORMS.filter(function(p) { return p.id !== 'all'; }).map(function(p) { return p.id; }).join('|'),
    };
    if (intent.yearTest) {
      var curYear = new Date().getFullYear();
      var fromYear = null, toYear = null;
      for (var yr = 1930; yr <= curYear; yr++) {
        if (intent.yearTest(yr)) { if (!fromYear) fromYear = yr; toYear = yr; }
      }
      if (fromYear) {
        base['primary_release_date.gte'] = fromYear + '-01-01';
        base['first_air_date.gte']       = fromYear + '-01-01';
        base['primary_release_date.lte'] = toYear   + '-12-31';
        base['first_air_date.lte']       = toYear   + '-12-31';
      }
    }
    return base;
  }

  // ── Run searches ──────────────────────────────────────────────────────────
  var titleSearchP = (intent.remainder || !intent.isConcept)
    ? apiCall('/search/multi', {query:(intent.remainder || q), language:'en-US', page:page, include_adult:false})
    : Promise.resolve({results:[], total_pages:0, total_results:0});

  var conceptMovieP = Promise.resolve(null);
  var conceptTvP    = Promise.resolve(null);

  if (intent.isConcept) {
    var discoverBase = getDiscoverBase();
    conceptMovieP = effectiveType === 'tv' ? Promise.resolve(null) : getKwIds().then(function(kwIds) {
      if (page === 1 || !_searchState) { /* will save below */ }
      var p = Object.assign({}, discoverBase, {page: page});
      if (intent.genres.length) {
        // Movie genre IDs: numeric IDs under 1000 + known 5-digit movie genres
        // Include 878 (Sci-Fi movie) but not 10765 (TV-only)
        var mg = intent.genres.filter(function(g) {
          return g < 1000 || [10749,10751,10752,10762,10770].indexOf(g) !== -1;
        });
        if (mg.length) p.with_genres = mg.join('|');
      }
      if (kwIds.length) p.with_keywords = kwIds.join('|');
      return apiCall('/discover/movie', p);
    });

    conceptTvP = effectiveType === 'movie' ? Promise.resolve(null) : getKwIds().then(function(kwIds) {
      var p = Object.assign({}, discoverBase, {page: page});
      if (intent.genres.length) {
        // TV genre IDs: high 5-digit IDs + shared small IDs (animation, comedy, etc.)
        // Include 10765 (Sci-Fi & Fantasy TV) and map 878 to 10765 for TV
        var tvGenres = intent.genres.map(function(g) {
          return g === 878 ? 10765 : g; // movie sci-fi -> TV sci-fi & fantasy
        }).filter(function(g) {
          return g >= 10000 || [16,35,80,99,18,37,53].indexOf(g) !== -1;
        });
        // Deduplicate
        var tg = tvGenres.filter(function(g, i) { return tvGenres.indexOf(g) === i; });
        if (tg.length) p.with_genres = tg.join('|');
      }
      if (kwIds.length) p.with_keywords = kwIds.join('|');
      return apiCall('/discover/tv', p);
    });
  }

  Promise.all([titleSearchP, conceptMovieP, conceptTvP, getKwIds()]).then(function(results) {
    var searchData    = results[0];
    var conceptMovies = results[1] ? results[1].results   : [];
    var conceptShows  = results[2] ? results[2].results   : [];
    var kwIds         = results[3];
    var discoverBase  = getDiscoverBase();

    var movieTotalPages = results[1] ? results[1].total_pages : 0;
    var tvTotalPages    = results[2] ? results[2].total_pages : 0;
    var titleTotalPages = searchData.total_pages || 0;

    // Cache state for Load More — preserve seenIds across pages
    var prevSeenIds = (_searchState && _searchState.seenIds) ? _searchState.seenIds : {};
    _searchState = {intent:intent, kwIds:kwIds, discoverBase:discoverBase,
      movieTotalPages:movieTotalPages, tvTotalPages:tvTotalPages, titleTotalPages:titleTotalPages,
      seenIds: page === 1 ? {} : prevSeenIds};

    // ── Split title search into people vs titles ───────────────────────────
    var people = page === 1
      ? (searchData.results||[]).filter(function(r) {
          return r.media_type === 'person' && (r.profile_path || r.known_for_department);
        })
      : [];

    var titleResults = (searchData.results||[]).filter(function(r) {
      return r.media_type !== 'person' && r.poster_path;
    });
    if (effectiveType === 'movie') titleResults = titleResults.filter(function(r) { return r.media_type === 'movie'; });
    if (effectiveType === 'tv')    titleResults = titleResults.filter(function(r) { return r.media_type === 'tv'; });

    // ── Deduplicate and merge ─────────────────────────────────────────────
    // On page > 1 we need to track seen IDs across pages — store on _searchState
    var seenIds = _searchState.seenIds;

    var allMovies = [];
    var allShows  = [];

    conceptMovies.forEach(function(m) {
      if (!seenIds[m.id]) { seenIds[m.id] = true; allMovies.push(m); }
    });
    conceptShows.forEach(function(s) {
      if (!seenIds[s.id]) { seenIds[s.id] = true; allShows.push(s); }
    });
    titleResults.filter(function(r) {
      if (!intent.yearTest) return true;
      var y = parseInt((r.release_date || r.first_air_date || '').slice(0,4));
      return y && intent.yearTest(y);
    }).forEach(function(r) {
      if (!seenIds[r.id]) {
        seenIds[r.id] = true;
        if (r.media_type === 'tv') allShows.push(r);
        else allMovies.push(r);
      }
    });

    var hasAnything = people.length || allMovies.length || allShows.length;

    if (page === 1 && !hasAnything) {
      main.innerHTML = emptyHTML('No results for "' + esc(q) + '"',
        intent.isConcept ? 'Try a different theme — e.g. "sci-fi", "horror 80s", "superhero"' : 'Try different keywords.');
      return;
    }

    // ── On page 1: build the header and static sections ───────────────────
    if (page === 1) {
      main.innerHTML = '';

      var interpretation = [];
      var genreNames = {28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
        99:'Documentary',18:'Drama',14:'Sci-Fi & Fantasy',27:'Horror',10749:'Romance',878:'Sci-Fi & Fantasy',
        9648:'Mystery',53:'Thriller',37:'Western',10764:'Reality',10765:'Sci-Fi & Fantasy',
        10759:'Action & Adv.',10751:'Family',10752:'War',10762:'Kids'};
      if (intent.genres.length) {
        var gns = intent.genres.slice(0,2).map(function(g) { return genreNames[g] || ''; }).filter(Boolean);
        if (gns.length) interpretation.push(gns.join(' / '));
      }
      if (intent.keywordTerms.length) interpretation.push(intent.keywordTerms[0]);
      if (intent.yearTest && !intent.genres.length) interpretation.push('filtered by era');

      var subtitleHtml = interpretation.length
        ? '<span style="font-size:13px;color:var(--muted);font-style:italic;margin-left:8px">(' + esc(interpretation.join(' \u00B7 ')) + ')</span>'
        : '';

      var hdr = document.createElement('div');
      hdr.className = 'results-header';
      hdr.id = 'search-hdr';
      hdr.innerHTML = '<div class="results-title">Results for <em style="color:var(--gold)">' + esc(q) + '</em>' + subtitleHtml + '</div>'
        + '<div class="results-count" id="search-count"></div>';
      main.appendChild(hdr);

      // People row (only page 1)
      if (people.length) {
        var ps = document.createElement('div');
        ps.className = 'people-section';
        var pt = document.createElement('div');
        pt.className = 'people-section-title';
        pt.innerHTML = '\uD83D\uDC64 People';
        ps.appendChild(pt);
        var pr = document.createElement('div');
        pr.className = 'people-row';
        people.forEach(function(person, i) {
          var dept = person.known_for_department || '';
          var role = dept === 'Acting' ? 'Actor / Actress' : dept === 'Directing' ? 'Director'
            : dept === 'Writing' ? 'Writer' : dept === 'Production' ? 'Producer' : dept || 'Crew';
          var ph = person.profile_path ? (IMGFACE + person.profile_path) : '';
          var card = document.createElement('div');
          card.className = 'person-card';
          card.style.animationDelay = Math.min(i * 30, 300) + 'ms';
          card.style.animation = 'cardIn .35s ease both';
          card.innerHTML = (ph ? '<img class="person-photo" src="' + ph + '" alt="' + esc(person.name) + '">'
            : '<div class="person-photo" style="display:flex;align-items:center;justify-content:center;font-size:28px">\uD83D\uDC64</div>')
            + '<div class="person-name">' + esc(person.name) + '</div>'
            + '<div class="person-role">' + esc(role) + '</div>';
          card.addEventListener('click', function() { loadPersonCredits(person.id, person.name, person.known_for_department, q); });
          pr.appendChild(card);
        });
        ps.appendChild(pr);
        main.appendChild(ps);
      }

      // Movie grid container
      if (effectiveType !== 'tv') {
        var ml = document.createElement('div');
        ml.className = 'people-section-title';
        ml.id = 'search-movie-label';
        ml.innerHTML = '\uD83C\uDFAC Movies';
        ml.style.display = 'none';
        main.appendChild(ml);
        var mg = document.createElement('div');
        mg.className = 'poster-grid';
        mg.id = 'search-movies-grid';
        main.appendChild(mg);
      }

      // TV grid container
      if (effectiveType !== 'movie') {
        var tl = document.createElement('div');
        tl.className = 'people-section-title';
        tl.id = 'search-tv-label';
        tl.innerHTML = '\uD83D\uDCFA TV Shows';
        tl.style.display = 'none';
        main.appendChild(tl);
        var tg = document.createElement('div');
        tg.className = 'poster-grid';
        tg.id = 'search-shows-grid';
        main.appendChild(tg);
      }
    }

    // ── Append cards to grids ─────────────────────────────────────────────
    var mGrid = document.getElementById('search-movies-grid');
    var tGrid = document.getElementById('search-shows-grid');
    var mLabel = document.getElementById('search-movie-label');
    var tLabel = document.getElementById('search-tv-label');
    var countEl = document.getElementById('search-count');

    // Remove old per-section buttons before appending new cards
    var omLM = document.getElementById('lm-search-movies');
    if (omLM) omLM.parentNode.removeChild(omLM);
    var otLM = document.getElementById('lm-search-shows');
    if (otLM) otLM.parentNode.removeChild(otLM);

    if (mGrid && allMovies.length) {
      if (mLabel) mLabel.style.display = '';
      allMovies.forEach(function(item, i) {
        var card = buildCard(item, 'movie', null);
        card.style.animationDelay = Math.min(i * 15, 300) + 'ms';
        mGrid.appendChild(card);
      });
      // Per-section Load More for Movies
      if (page < Math.max(movieTotalPages, titleTotalPages)) {
        var np1 = page + 1;
        var mBtn = makeSectionLoadMoreBtn('Load More Movies', 'lm-search-movies', function() {
          runSearch(q, np1);
        });
        mGrid.parentNode.insertBefore(mBtn, mGrid.nextSibling);
      }
    }

    if (tGrid && allShows.length) {
      if (tLabel) tLabel.style.display = '';
      allShows.forEach(function(item, i) {
        var card = buildCard(item, 'tv', null);
        card.style.animationDelay = Math.min(i * 15, 300) + 'ms';
        tGrid.appendChild(card);
      });
      // Per-section Load More for TV Shows
      if (page < Math.max(tvTotalPages, titleTotalPages)) {
        var np2 = page + 1;
        var tBtn = makeSectionLoadMoreBtn('Load More TV Shows', 'lm-search-shows', function() {
          runSearch(q, np2);
        });
        tGrid.parentNode.insertBefore(tBtn, tGrid.nextSibling);
      }
    }

    // Update count
    if (countEl) {
      var totalCards = (mGrid ? mGrid.children.length : 0) + (tGrid ? tGrid.children.length : 0);
      countEl.textContent = totalCards + ' titles';
    }

  }).catch(function(e) {
    if (page === 1) main.innerHTML = emptyHTML('Search failed', e.message);
  });
}


// Load filmography for a person (actor or director)
function loadPersonCredits(personId, personName, department, searchQuery) {
  var main = document.getElementById('main');
  main.innerHTML = skelShelves(2);
  showFilterBar(false);

  Promise.all([
    apiCall('/person/' + personId, {language:'en-US'}),
    apiCall('/person/' + personId + '/combined_credits', {language:'en-US'}),
  ]).then(function(results) {
    var person  = results[0];
    var credits = results[1];

    main.innerHTML = '';

    // ── Back button ────────────────────────────────────────────────────────
    var backBtn = document.createElement('button');
    backBtn.className = 'back-btn';
    backBtn.innerHTML = '\u2190 Back to results';
    backBtn.onclick = function() {
      document.getElementById('searchInput').value = searchQuery || '';
      searchQuery && runSearch(searchQuery);
    };
    main.appendChild(backBtn);

    // ── Use the person API's known_for_department as the true primary role ──
    // Don't infer from credit counts — that's what caused directors with
    // many talk-show self appearances to look like actors.
    var primaryDept = person.known_for_department || department || 'Acting';

    // ── Helper: detect "self" appearances ─────────────────────────────────
    function isSelfAppearance(credit) {
      var ch = (credit.character || '').toLowerCase().trim();
      return ch === 'self' || ch === 'himself' || ch === 'herself'
        || ch === 'themselves' || ch === 'host' || ch === 'narrator'
        || ch === 'guest' || ch === 'interviewee' || ch === 'panelist'
        || ch.indexOf('self -') === 0 || ch.indexOf('himself -') === 0
        || ch.indexOf('herself -') === 0 || ch === ''
        || (credit.media_type === 'tv' && ch.indexOf('self') !== -1);
    }

    // ── Split cast credits into real roles vs self appearances ────────────
    var allCast = (credits.cast || []).filter(function(c) { return c.poster_path; });
    var selfItems   = allCast.filter(function(c) { return  isSelfAppearance(c); });
    var actingItems = allCast.filter(function(c) { return !isSelfAppearance(c); });

    // ── Crew: directing, writing, producing ───────────────────────────────
    var CREW_JOBS = ['Director','Writer','Screenplay','Story','Executive Producer',
                     'Producer','Creator','Showrunner','Original Story'];
    var crewItems = (credits.crew || []).filter(function(c) {
      return c.poster_path &&
        (CREW_JOBS.indexOf(c.job) !== -1 ||
         c.department === 'Directing' ||
         c.department === 'Writing');
    });

    // ── Deduplicate by TMDB id within each bucket ─────────────────────────
    function dedupe(arr) {
      var seen = {};
      return arr.filter(function(c) {
        if (seen[c.id]) return false;
        seen[c.id] = true; return true;
      });
    }

    // ── Sort all buckets alphabetically by title ───────────────────────────
    // Movies and TV are already combined — no separate shelves by type.
    function byTitle(a, b) {
      var ta = (a.title || a.name || '').toLowerCase();
      var tb = (b.title || b.name || '').toLowerCase();
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    }
    selfItems   = dedupe(selfItems.sort(byTitle));
    actingItems = dedupe(actingItems.sort(byTitle));
    crewItems   = dedupe(crewItems.sort(byTitle));

    // ── Determine primary role label for hero badge ────────────────────────
    var deptLabel = primaryDept === 'Acting'    ? 'Actor / Actress'
      : primaryDept === 'Directing' ? 'Director'
      : primaryDept === 'Writing'   ? 'Writer'
      : primaryDept === 'Production'? 'Producer'
      : primaryDept || 'Crew';

    // ── Shelf order: lead with primary department first ────────────────────
    // A director's directed films come first; an actor's roles come first.
    var shelves = [];

    if (primaryDept === 'Directing' || primaryDept === 'Writing' || primaryDept === 'Production') {
      if (crewItems.length)   shelves.push({icon:'\uD83C\uDEC2', label:'Directed & Written',   items:crewItems,   type:'mixed'});
      if (actingItems.length) shelves.push({icon:'\uD83C\uDFAC', label:'Acting Roles',          items:actingItems, type:'mixed'});
    } else {
      // Actor, or unknown — acting roles first
      if (actingItems.length) shelves.push({icon:'\uD83C\uDFAC', label:'Acting Roles',          items:actingItems, type:'mixed'});
      if (crewItems.length)   shelves.push({icon:'\uD83C\uDEC2', label:'Directed & Written',   items:crewItems,   type:'mixed'});
    }
    // Self / talk-show appearances always last
    if (selfItems.length)   shelves.push({icon:'\uD83D\uDCFA', label:'Appears As Themselves', items:selfItems,   type:'mixed'});

    // ── Render hero with corrected label ──────────────────────────────────
    var photoSrc = person.profile_path ? (IMGW + person.profile_path) : '';
    var bday = person.birthday ? person.birthday.slice(0,4) : '';
    var birthplace = person.place_of_birth || '';
    var metaParts = [];
    if (bday) metaParts.push('Born ' + bday);
    if (birthplace) metaParts.push(birthplace);
    var bio = (person.biography || '').trim();
    var totalCredits = actingItems.length + crewItems.length;

    var hero = document.createElement('div');
    hero.className = 'person-hero';
    hero.innerHTML = (photoSrc
      ? '<img class="person-hero-photo" src="' + photoSrc + '" alt="' + esc(person.name) + '">'
      : '<div class="person-hero-photo" style="display:flex;align-items:center;justify-content:center;font-size:40px">\uD83D\uDC64</div>')
      + '<div class="person-hero-info">'
      + '<div class="person-hero-name">' + esc(person.name) + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'
      + '<span class="dept-badge">' + esc(deptLabel) + '</span>'
      + (metaParts.length ? '<span style="font-size:12px;color:var(--muted)">' + esc(metaParts.join(' \u00B7 ')) + '</span>' : '')
      + (totalCredits ? '<span style="font-size:12px;color:var(--muted)">' + totalCredits + ' credits</span>' : '')
      + '</div>'
      + (bio ? '<div class="person-hero-bio">' + esc(bio.substring(0, 320)) + (bio.length > 320 ? '\u2026' : '') + '</div>' : '')
      + '</div>';
    main.appendChild(hero);

    // ── Render each shelf ─────────────────────────────────────────────────
    shelves.forEach(function(s) {
      renderShelf(main,
        s.icon + ' ' + esc(person.name) + ' \u2014 ' + s.label + ' (' + s.items.length + ')',
        s.items, s.type);
    });

    if (!shelves.length) {
      main.innerHTML += emptyHTML('No credits found', 'This person may not have any listed credits yet.');
    }

  }).catch(function(e) {
    main.innerHTML = emptyHTML('Could not load filmography', e.message);
  });
}

// RENDER
function renderShelf(container, title, items, type) {
  var shelf = document.createElement('div');
  shelf.className = 'shelf';
  var hdr = document.createElement('div');
  hdr.className = 'shelf-header';
  var ht = document.createElement('div');
  ht.className = 'shelf-title';
  ht.innerHTML = title;
  hdr.appendChild(ht);
  shelf.appendChild(hdr);
  var grid = document.createElement('div');
  grid.className = 'poster-grid';
  items.forEach(function(item, i) {
    var card = buildCard(item, type, item._pids || null);
    card.style.animationDelay = Math.min(i * 20, 400) + 'ms';
    grid.appendChild(card);
  });
  shelf.appendChild(grid);
  container.appendChild(shelf);
}

function buildCard(item, type, platformIds) {
  var card = document.createElement('div');
  card.className = 'pcard';
  var title     = item.title || item.name || 'Untitled';
  var year      = (item.release_date || item.first_air_date || '').slice(0,4);
  var rating    = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : null;
  var mediaType = item.media_type || type;
  var isTv      = (mediaType === 'tv');

  var frame = document.createElement('div');
  frame.className = 'pframe';

  if (item.poster_path) {
    var img = document.createElement('img');
    img.className = 'pimg';
    img.src = IMGCARD + item.poster_path;
    img.alt = title;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = function() {
      var ph = document.createElement('div');
      ph.className = 'pplaceholder';
      ph.innerHTML = '<span class="ph-icon">\uD83C\uDFAC</span><span>' + esc(title.substring(0,30)) + '</span>';
      if (this.parentNode) this.parentNode.replaceChild(ph, this);
    };
    frame.appendChild(img);
  } else {
    var ph = document.createElement('div');
    ph.className = 'pplaceholder';
    ph.innerHTML = '<span class="ph-icon">\uD83C\uDFAC</span><span>' + esc(title.substring(0,30)) + '</span>';
    frame.appendChild(ph);
  }

  if (rating) {
    var rb = document.createElement('div');
    rb.className = 'rating-badge';
    rb.textContent = '\u2605 ' + rating;
    frame.appendChild(rb);
  }
  if (isTv) {
    var tb = document.createElement('div');
    tb.className = 'type-badge';
    tb.textContent = 'TV';
    frame.appendChild(tb);
  }
  var ov = document.createElement('div');
  ov.className = 'poverlay';
  var pl = document.createElement('div');
  pl.className = 'pplay';
  pl.textContent = '\u25B6';
  ov.appendChild(pl);
  frame.appendChild(ov);
  card.appendChild(frame);

  var titleEl = document.createElement('div');
  titleEl.className = 'ptitle';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  var metaEl = document.createElement('div');
  metaEl.className = 'pmeta';
  var metaParts = [];
  if (year) metaParts.push(year);
  if (isTv && item.number_of_seasons) {
    metaParts.push(item.number_of_seasons + (item.number_of_seasons === 1 ? ' Season' : ' Seasons'));
  }
  metaEl.textContent = metaParts.join(' \u00B7 ') || '\u2014';
  card.appendChild(metaEl);

  if (platformIds && platformIds.length > 0) {
    var br = document.createElement('div');
    br.className = 'pbadges';
    platformIds.slice(0,5).forEach(function(pid) {
      var p = findPlatform(pid);
      if (!p || p.id === 'all') return;
      var badge = document.createElement('span');
      badge.className = 'pbadge';
      badge.style.background = p.color + '28';
      badge.style.color = p.color;
      badge.style.border = '1px solid ' + p.color + '44';
      badge.textContent = p.short;
      br.appendChild(badge);
    });
    card.appendChild(br);
  }

  card.addEventListener('click', function() {
    openDetail(item.id, isTv ? 'tv' : 'movie');
  });
  return card;
}

// DETAIL MODAL
function openDetail(id, type) {
  var modal = document.getElementById('detailModal');
  var inner = document.getElementById('detailInner');
  modal.classList.add('open');
  inner.innerHTML = '<div style="padding:60px;text-align:center;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">\u29BB</div>Loading\u2026</div>';

  Promise.all([
    apiCall('/' + type + '/' + id, {language:'en-US'}),
    apiCall('/' + type + '/' + id + '/credits', {language:'en-US'}),
    apiCall('/' + type + '/' + id + '/watch/providers'),
    apiCall('/' + type + '/' + id + '/recommendations', {language:'en-US', page:1}),
  ]).then(function(results) {
    var detail    = results[0];
    var credits   = results[1];
    var streaming = results[2];
    var similar   = results[3];

    var us = (streaming.results && streaming.results.US) ? streaming.results.US : {};
    var streamOpts  = (us.flatrate || []).concat(us.free || []);
    var rentOpts    = us.rent  || [];
    var buyOpts     = us.buy   || [];

    // Known typical rental price tiers by provider (USD, SD price)
    // These are approximate standard prices — actual prices may vary by title
    var RENTAL_PRICES = {
      2:    {rent:'$3.99',  buy:'$9.99'},   // Apple TV (iTunes)
      3:    {rent:'$3.99',  buy:'$12.99'},  // Google Play
      7:    {rent:'$3.99',  buy:'$9.99'},   // Vudu
      10:   {rent:'$3.99',  buy:'$12.99'},  // Amazon Video
      68:   {rent:'$3.99',  buy:'$9.99'},   // Microsoft / Xbox
      100:  {rent:'$3.99',  buy:'$9.99'},   // Amazon Prime (buy)
      192:  {rent:'$3.99',  buy:'$12.99'},  // YouTube
      207:  {rent:null,     buy:null},       // Tubi (free)
    };

    function getRentPrice(providerId) {
      var p = RENTAL_PRICES[providerId];
      return p ? p.rent : '$3.99';
    }
    function getBuyPrice(providerId) {
      var p = RENTAL_PRICES[providerId];
      return p ? p.buy : '$12.99';
    }

    // Deduplicate rent/buy — remove any that are already in streaming
    var streamIds = {};
    streamOpts.forEach(function(p) { streamIds[p.provider_id] = true; });
    rentOpts = rentOpts.filter(function(p) { return !streamIds[p.provider_id]; });

    // Deduplicate buy — remove any in rent list  
    var rentIds = {};
    rentOpts.forEach(function(p) { rentIds[p.provider_id] = true; });
    buyOpts = buyOpts.filter(function(p) { return !rentIds[p.provider_id] && !streamIds[p.provider_id]; });
    var cast = (credits.cast || []).slice(0,10);
    var simItems = (similar.results || []).filter(function(s) { return s.poster_path; }).slice(0,16);

    var title    = detail.title || detail.name;
    var year     = (detail.release_date || detail.first_air_date || '').slice(0,4);
    var rating   = detail.vote_average ? parseFloat(detail.vote_average).toFixed(1) : null;
    var genres   = (detail.genres || []).slice(0,4);
    var overview = detail.overview || 'No overview available.';
    var seasons  = (type === 'tv' && detail.number_of_seasons)  ? detail.number_of_seasons  : null;
    var episodes = (type === 'tv' && detail.number_of_episodes) ? detail.number_of_episodes : null;
    // Filter out "Specials" season (season 0) from the count if present
    if (seasons && detail.seasons) {
      var realSeasons = detail.seasons.filter(function(s) { return s.season_number > 0 && s.episode_count > 0; });
      if (realSeasons.length) seasons = realSeasons.length;
    }
    var runtime = detail.runtime ? detail.runtime : (detail.episode_run_time && detail.episode_run_time[0] ? detail.episode_run_time[0] : null);

    var html = '<div class="mhero">';
    if (detail.backdrop_path) html += '<img class="mhero-img" src="' + IMGBIG + detail.backdrop_path + '" alt="">';
    else html += '<div style="width:100%;height:100%;background:var(--surface2)"></div>';
    html += '<div class="mhero-grad"></div>';
    html += '<button class="mclose" onclick="closeModal()">\u2715</button>';
    if (detail.poster_path) html += '<img class="mposter" src="' + IMGW + detail.poster_path + '" alt="' + esc(title) + '">';
    html += '</div>';

    html += '<div class="mbody">';
    html += '<div class="mtitle">' + esc(title) + '</div>';
    html += '<div class="mmeta">';
    if (year)     html += '<span class="myear">' + year + '</span><span class="mdot">&middot;</span>';
    if (seasons)  html += '<span class="myear">' + seasons + (seasons === 1 ? ' Season' : ' Seasons') + '</span><span class="mdot">&middot;</span>';
    if (episodes && seasons && seasons > 1) html += '<span class="myear">' + episodes + ' Episodes</span><span class="mdot">&middot;</span>';
    if (runtime)  html += '<span class="myear">' + runtime + ' min</span><span class="mdot">&middot;</span>';
    if (rating)   html += '<span class="mrating">\u2605 ' + rating + '</span><span class="mdot">&middot;</span>';
    html += '<span class="mgenres">' + genres.map(function(g) { return '<span class="gtag">' + esc(g.name) + '</span>'; }).join('') + '</span>';
    html += '</div>';

    // ── Profile action buttons ─────────────────────────────────────────────
    // Store item in cache so onclick handlers only need the numeric id
    _modalItems[id] = { item: detail, type: type };
    var isW  = isWatched(id, type);
    var isWL = isWatchlist(id, type);
    html += '<div class="modal-actions">';
    html += '<button id="maction-watched-'   + id + '" class="maction-btn' + (isW  ? ' watched'   : '') + '"'
      + ' onclick="handleWatchedClick('   + id + ',\'' + type + '\')">'
      + (isW  ? '\u2714 Watched'           : '\uD83D\uDC41 Mark as Watched') + '</button>';
    html += '<button id="maction-watchlist-' + id + '" class="maction-btn' + (isWL ? ' watchlist'  : '') + '"'
      + ' onclick="handleWatchlistClick(' + id + ',\'' + type + '\')">'
      + (isWL ? '\u2B50 In ' + listCountForItem(id,type) + (listCountForItem(id,type)===1?' List':' Lists') : '+ Add to List') + '</button>';
    html += '</div>';

    html += '<div class="mtabs">';
    html += '<button class="mtab active" onclick="switchTab(\'overview\',this)">Overview</button>';
    if (cast.length) html += '<button class="mtab" onclick="switchTab(\'cast\',this)">Cast</button>';
    if (simItems.length) html += '<button class="mtab" onclick="switchTab(\'similar\',this)">You May Also Like</button>';
    html += '</div>';

    html += '<div class="mtab-panel active" id="tab-overview">';
    html += '<p class="moverview">' + esc(overview) + '</p>';
    html += '<div class="mwhere-label">Where to Watch</div>';

    // ── Streaming (included with subscription) ────────────────────────────
    if (streamOpts.length) {
      var shownPids = {};
      html += '<div class="mwhere-section-label">Streaming</div>';
      html += '<div class="mplatforms" style="margin-bottom:16px">';
      streamOpts.forEach(function(p) {
        if (shownPids[p.provider_id]) return;
        shownPids[p.provider_id] = true;
        var known = findPlatform(p.provider_id);
        var color = known ? known.color : '#555';
        var label = known ? known.label : p.provider_name;
        var url   = PLATFORM_URLS[p.provider_id] || '#';
        var logoInner = p.logo_path
          ? '<img src="' + IMGLOGO + p.logo_path + '" style="width:100%;height:100%;object-fit:cover;border-radius:5px" alt="">'
          : (known ? known.short : p.provider_name.charAt(0));
        html += '<a class="mplat-btn" href="' + url + '" target="_blank">'
          + '<div class="mplat-icon" style="background:' + color + '">' + logoInner + '</div>'
          + esc(label) + '</a>';
      });
      html += '</div>';
    }

    // ── Rent ─────────────────────────────────────────────────────────────
    if (rentOpts.length) {
      html += '<div class="mwhere-section-label">Rent</div>';
      html += '<div class="mplatforms" style="margin-bottom:16px">';
      var shownRent = {};
      rentOpts.forEach(function(p) {
        if (shownRent[p.provider_id]) return;
        shownRent[p.provider_id] = true;
        var logoInner = p.logo_path
          ? '<img src="' + IMGLOGO + p.logo_path + '" style="width:100%;height:100%;object-fit:cover;border-radius:5px" alt="">'
          : p.provider_name.charAt(0);
        var price = getRentPrice(p.provider_id);
        var url = PLATFORM_URLS[p.provider_id] || '#';
        html += '<a class="mplat-btn mplat-rent" href="' + url + '" target="_blank">'
          + '<div class="mplat-icon" style="background:#2d2d2d">' + logoInner + '</div>'
          + '<div><div style="font-size:12px">' + esc(p.provider_name) + '</div>'
          + '<div class="mplat-price">' + (price || 'from ~$3.99') + '</div></div>'
          + '</a>';
      });
      html += '</div>';
    }

    // ── Buy ───────────────────────────────────────────────────────────────
    if (buyOpts.length) {
      html += '<div class="mwhere-section-label">Buy</div>';
      html += '<div class="mplatforms" style="margin-bottom:16px">';
      var shownBuy = {};
      buyOpts.forEach(function(p) {
        if (shownBuy[p.provider_id]) return;
        shownBuy[p.provider_id] = true;
        var logoInner = p.logo_path
          ? '<img src="' + IMGLOGO + p.logo_path + '" style="width:100%;height:100%;object-fit:cover;border-radius:5px" alt="">'
          : p.provider_name.charAt(0);
        var price = getBuyPrice(p.provider_id);
        var url = PLATFORM_URLS[p.provider_id] || '#';
        html += '<a class="mplat-btn mplat-buy" href="' + url + '" target="_blank">'
          + '<div class="mplat-icon" style="background:#2d2d2d">' + logoInner + '</div>'
          + '<div><div style="font-size:12px">' + esc(p.provider_name) + '</div>'
          + '<div class="mplat-price">' + (price || 'from ~$12.99') + '</div></div>'
          + '</a>';
      });
      html += '</div>';
    }

    // ── Not available anywhere ────────────────────────────────────────────
    if (!streamOpts.length && !rentOpts.length && !buyOpts.length) {
      html += '<div class="mno-stream">Not currently available to stream, rent, or buy in the US.</div>';
    }

    // ── JustWatch attribution (required by their data license) ────────────
    if (streamOpts.length || rentOpts.length || buyOpts.length) {
      html += '<div class="mwhere-attr">Streaming data via <a href="https://www.justwatch.com" target="_blank" style="color:var(--gold);text-decoration:none">JustWatch</a>. Prices are estimates — click to confirm current pricing.</div>';
    }

    html += '</div></div>';

    if (cast.length) {
      html += '<div class="mtab-panel" id="tab-cast"><div class="cast-row">';
      cast.forEach(function(c) {
        html += '<div class="ccard">';
        if (c.profile_path) html += '<img class="cphoto" src="' + IMGFACE + c.profile_path + '" alt="' + esc(c.name) + '">';
        else html += '<div class="cphoto" style="display:flex;align-items:center;justify-content:center;font-size:22px">\uD83D\uDC64</div>';
        html += '<div class="cname">' + esc(c.name) + '</div></div>';
      });
      html += '</div></div>';
    }

    if (simItems.length) {
      html += '<div class="mtab-panel" id="tab-similar"><div class="sim-grid">';
      simItems.forEach(function(s) {
        var st = esc(s.title || s.name || '');
        var sy = (s.release_date || s.first_air_date || '').slice(0,4);
        var sr = s.vote_average ? parseFloat(s.vote_average).toFixed(1) : null;
        html += '<div class="scard" onclick="closeModal();var tid=' + s.id + ';setTimeout(function(){openDetail(tid,\'' + type + '\')},200)">'
          + '<img class="simg" src="' + IMGW + s.poster_path + '" alt="' + st + '">'
          + '<div class="stitle">' + st + '</div>'
          + '<div class="smeta">' + (sy || '') + (sr ? ' &nbsp;&middot;&nbsp; \u2605 ' + sr : '') + '</div>'
          + '</div>';
      });
      html += '</div></div>';
    }
    html += '</div>';
    inner.innerHTML = html;

  }).catch(function(e) {
    inner.innerHTML = '<button class="mclose" onclick="closeModal()" style="position:absolute;top:14px;right:14px">\u2715</button>'
      + '<div style="padding:60px;text-align:center;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">\u26A0\uFE0F</div><div>Could not load details: ' + esc(e.message) + '</div></div>';
  });
}

function closeModal() { document.getElementById('detailModal').classList.remove('open'); }

function switchTab(name, btn) {
  document.querySelectorAll('.mtab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.mtab-panel').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  var panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
}

// HELPERS
function setType(t, btn) {
  currentType = t;
  activeGenre = null;
  document.querySelectorAll('.type-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  buildGenreBar();
  if (searchQuery) { runSearch(searchQuery); return; }
  applyFilters();
}

function goHome() {
  document.getElementById('searchInput').value = '';
  searchQuery = '';
  document.getElementById('searchClear').classList.remove('vis');
  buildGenreBar();
  selectPlatform('all');
}

function findPlatform(id) {
  return PLATFORMS.find(function(p) { return p.id === id; }) || null;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function emptyHTML(title, sub) {
  return '<div class="empty"><div class="empty-icon">\uD83C\uDFAC</div><div class="empty-title">' + esc(title) + '</div><div class="empty-sub">' + esc(sub) + '</div></div>';
}

function skelShelves(n) {
  var row = '';
  for (var i = 0; i < 12; i++) row += '<div class="skel-card"><div class="skel-poster"></div><div class="skel-line" style="width:85%"></div><div class="skel-line" style="width:50%"></div></div>';
  var shelf = '<div class="shelf"><div class="shelf-header"><div class="skel-line" style="width:200px;height:22px;border-radius:6px;background:var(--surface2)"></div></div><div class="poster-grid">' + row + '</div></div>';
  var out = ''; for (var j = 0; j < n; j++) out += shelf; return out;
}

function skelGrid(n) {
  var c = ''; for (var i = 0; i < n; i++) c += '<div class="skel-card"><div class="skel-poster"></div><div class="skel-line" style="width:85%"></div><div class="skel-line" style="width:50%"></div></div>';
  return '<div class="poster-grid">' + c + '</div>';
}

var toastTimer;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2800);
}

init();

// ── Global exposure ─────────────────────────────────────────────────────────
// This module's top-level declarations are scoped to the module, not `window`,
// but the HTML shell still wires interactions via inline on* attributes
// (onclick, oninput, onchange, onmouseover/out). Expose exactly the functions
// those attributes call, by name, so the existing markup keeps working unchanged.
window.applyProfileFilters = applyProfileFilters;
window.applyYearFilter = applyYearFilter;
window.clearSearch = clearSearch;
window.closeListEditModal = closeListEditModal;
window.closeListPicker = closeListPicker;
window.closeModal = closeModal;
window.closeProfile = closeProfile;
window.closeRatingModal = closeRatingModal;
window.confirmDeleteList = confirmDeleteList;
window.editProfileName = editProfileName;
window.goHome = goHome;
window.handleWatchedClick = handleWatchedClick;
window.handleWatchlistClick = handleWatchlistClick;
window.openDetail = openDetail;
window.openList = openList;
window.openNewListModal = openNewListModal;
window.openProfile = openProfile;
window.previewStar = previewStar;
window.removeAndCloseRating = removeAndCloseRating;
window.resetFilters = resetFilters;
window.resetProfileFilters = resetProfileFilters;
window.saveListEdit = saveListEdit;
window.saveProfileName = saveProfileName;
window.saveRating = saveRating;
window.selectGenre = selectGenre;
window.selectPlatform = selectPlatform;
window.selectSwatch = selectSwatch;
window.setLangOption = setLangOption;
window.setRatingOption = setRatingOption;
window.setRatingStar = setRatingStar;
window.setSortOption = setSortOption;
window.setType = setType;
window.setVotesOption = setVotesOption;
window.showListsOverview = showListsOverview;
window.signOutUser = signOutUser;
window.submitAuth = submitAuth;
window.switchProfileTab = switchProfileTab;
window.switchTab = switchTab;
window.toggleAuthMode = toggleAuthMode;
window.toggleDropdown = toggleDropdown;
window.toggleListMembership = toggleListMembership;
window.updateRangeLabel = updateRangeLabel;
