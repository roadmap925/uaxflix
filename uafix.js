/**
 * UAfix — Lampa plugin for uafix.net  v0.3
 * Install: add this URL in Lampa → Extensions
 *
 * Debug log: open Lampa → Settings → Console and filter by [UAfix]
 */
(function () {
    'use strict';

    // ─── CONFIG ────────────────────────────────────────────────────────────────
    var PLUGIN_NAME  = 'uafix';
    var DEFAULT_HOST = 'https://uafix.net';
    var DEFAULT_PROXY = 'http://192.168.12.133:5000/?url=';

    // ─── UTILS ─────────────────────────────────────────────────────────────────

    function log() {
        var a = Array.prototype.slice.call(arguments);
        a.unshift('[UAfix]');
        console.log.apply(console, a);
    }

    function getDomain() {
        return (Lampa.Storage.get('uafix_domain', DEFAULT_HOST) || DEFAULT_HOST).replace(/\/$/, '');
    }

    function getProxy() {
    return Lampa.Storage.get('uafix_proxy', DEFAULT_PROXY) || DEFAULT_PROXY;
    }

    function withProxy(url) {
        var p = getProxy();
        return p ? p + encodeURIComponent(url) : url;
    }

    function safeFind(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i])) return arr[i];
        }
        return undefined;
    }

    // Non-content page patterns to exclude (search, tags, pages, system paths)
    var SKIP_PATH_RE = /\/(search|tag[s]?|categor|page\/\d|login|register|admin|feed|wp-|do=search|index\.php)/i;

    function isContentUrl(url) {
        if (!url) return false;

        // Must belong to the configured domain
        var domain = getDomain().replace(/^https?:\/\//, '').replace(/^www\./, '');
        var m = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)(\/[^?#]*)/);
        if (!m) return false;

        var host = m[1].replace(/^www\./, '');
        var path = m[2];

        // Reject system/navigation URLs
        if (SKIP_PATH_RE.test(path)) return false;
        // Must have at least one meaningful path segment (slug)
        if (!path || path === '/' || path.split('/').filter(Boolean).length < 1) return false;
        // Must be from the right domain
        return host === domain;
    }

    // ─── NETWORK ───────────────────────────────────────────────────────────────

    // Browser-like headers to avoid bot detection
    var HEADERS = {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
        'Referer':         DEFAULT_HOST + '/'
    };

    /**
     * GET url → callback(err, text)
     * Tries Lampa.Reguest.silent first (bypasses CORS on Android), then fetch().
     */
    function request(url, callback, timeout) {
        timeout = timeout || 15000;
        var finalUrl = withProxy(url);
        log('GET', finalUrl);

        var settled = false;
        var timer;
        var network;

        function settle(err, text) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(err, text);
        }

        // ── Try Lampa.Reguest ──────────────────────────────────────────
        try {
            network = new Lampa.Reguest();

            // Check the method exists (it's a misspelling in Lampa)
            if (typeof network.silent !== 'function') throw new Error('no silent');

            timer = setTimeout(function () {
                try { network.clear(); } catch (e) {}
                if (!settled) { settled = true; fetchGet(url, callback, timeout); }
            }, timeout);

            network.silent(finalUrl,
                function (text) { settle(null, text || ''); },
                function () {
                    clearTimeout(timer);
                    if (!settled) { settled = true; fetchGet(url, callback, timeout); }
                },
                false,
                { dataType: 'text' }
            );
            return;
        } catch (e) {
            clearTimeout(timer);
            log('Lampa.Reguest unavailable, using fetch:', e.message);
        }

        fetchGet(url, callback, timeout);
    }

    function fetchGet(url, callback, timeout) {
        timeout = timeout || 15000;
        var finalUrl = withProxy(url);
        log('fetch', finalUrl);

        var controller = null;
        var timer;
        var settled = false;

        function settle(err, text) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(err, text);
        }

        try {
            if (window.AbortController) controller = new AbortController();
            timer = setTimeout(function () {
                if (controller) try { controller.abort(); } catch (e) {}
                settle(new Error('Timeout after ' + timeout + 'ms'), null);
            }, timeout);
        } catch (e) {}

        var opts = { method: 'GET', headers: HEADERS };
        if (controller) opts.signal = controller.signal;

        fetch(finalUrl, opts)
    .then(function (r) {
        clearTimeout(timer);
        log('HTTP status:', r.status, finalUrl);
        return r.text();
    })
    .then(function (t) {
        log('Response length:', t.length, 'snippet:', t.slice(0, 200));
        if (t.length < 100) { settle(new Error('Empty response'), null); return; }
        settle(null, t);
    })
    .catch(function (e) {
        log('fetch error:', e.message, finalUrl);
        settle(e, null);
    });
    }

    function postFetch(url, body, callback) {
        log('POST', withProxy(url));
        fetch(withProxy(url), {
            method:  'POST',
            headers: (function (h) { h['Content-Type'] = 'application/x-www-form-urlencoded'; return h; })(
                        { 'User-Agent': HEADERS['User-Agent'], 'Accept': HEADERS['Accept'],
                          'Accept-Language': HEADERS['Accept-Language'], 'Referer': HEADERS['Referer'] }
                     ),
            body:    body
        })
            .then(function (r) { return r.text(); })
            .then(function (t) { callback(null, t); })
            .catch(function (e) { callback(e, null); });
    }

    // ─── AD STRIPPING ──────────────────────────────────────────────────────────

    var AD_NETS = [
        'googlesyndication', 'doubleclick', 'adsbygoogle', 'popunder',
        'push-monetization', 'adngin', 'adskeeper', 'trafficjunky',
        'exoclick', 'juicyads', 'propellerads', 'adcash', 'hilltopads',
        'plugrush', 'adsterra', 'etarget', 'mgid', 'zedo', 'popcash'
    ];

    function stripAds(html) {
        html = html.replace(/<script[\s\S]*?<\/script>/gi, function (m) {
            var low = m.toLowerCase();
            for (var i = 0; i < AD_NETS.length; i++) {
                if (low.indexOf(AD_NETS[i]) !== -1) return '';
            }
            return m;
        });
        html = html.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, function (m) {
            return /ad|banner|pop|sponsor|promo/i.test(m) ? '' : m;
        });
        return html;
    }

    // ─── PARSERS ───────────────────────────────────────────────────────────────

    function parseSearchResults(html, domain) {
        var results = [];
        domain = domain || getDomain();

        // Strip script/style to avoid false positives in inline JS
        var clean = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '');

        function add(href, rawTitle, yearHint) {
            if (!href || !rawTitle) return;

            // Resolve relative URLs
            if (href.charAt(0) === '/') href = domain + href;

            // Must look like a content page
            if (!isContentUrl(href)) return;

            // Skip duplicates
            if (results.some(function (r) { return r.url === href; })) return;

            // Clean up title: strip HTML tags, collapse whitespace
            var title = rawTitle
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/\(\d{4}\)/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (title.length < 2) return;

            // Year: try from title hint, then URL, then yearHint param
            var year = '';
            var ym = (yearHint || title + ' ' + href).match(/\b(19|20)\d{2}\b/);
            if (ym) year = ym[0];

            results.push({ url: href, title: title, year: year });
        }

        // ── Strategy 1: <a href="content-url">…<h3>title</h3>…</a> ─────────
        var anchorRe = /<a[^>]+href="([^"#?]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi;
        var am;
        while ((am = anchorRe.exec(clean)) !== null) {
            var href = am[1];
            var inner = am[2];
            if (!isContentUrl(href)) continue;

            var h3m = inner.match(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/i);
            if (h3m) {
                var titleAttr = am[0].match(/\btitle="([^"]+)"/);
                add(href, h3m[1], titleAttr ? titleAttr[1] : '');
                continue;
            }

            var tAttr = am[0].match(/\btitle="([^"]+)"/);
            if (tAttr && tAttr[1].length > 3) {
                add(href, tAttr[1], '');
            }
        }

        // ── Strategy 2: link scan without surrounding <a>…</a> pairs ────────
        if (results.length === 0) {
            var hrefRe = /href="([^"#?]+)"/gi;
            var hm;
            while ((hm = hrefRe.exec(clean)) !== null) {
                var hurl = hm[1];
                if (!isContentUrl(hurl)) continue;
                if (hurl.charAt(0) === '/') hurl = domain + hurl;
                if (results.some(function (r) { return r.url === hurl; })) continue;

                var ctx = clean.slice(Math.max(0, hm.index - 20), hm.index + 500);
                var ctxH3 = ctx.match(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/i);
                if (ctxH3) {
                    add(hurl, ctxH3[1], '');
                }
            }
        }

        log('parseSearchResults →', results.length, 'results:', results.slice(0, 3));
        return results;
    }

    function guessQuality(url) {
        if (/2160|4[kK]/.test(url)) return '2160p';
        if (/1080/.test(url))       return '1080p';
        if (/720/.test(url))        return '720p';
        if (/480/.test(url))        return '480p';
        if (/360/.test(url))        return '360p';
        if (/\.m3u8/.test(url))     return 'HLS';
        return 'Auto';
    }

    function normaliseUrl(u) {
        if (!u) return '';
        u = u.trim();
        if (u.indexOf('//') === 0) return 'https:' + u;
        return u;
    }

    function parseMoviePage(html) {
        var info = { title: '', iframe: '', streams: {}, episodes: [] };

        var tM = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (tM) info.title = tM[1].trim();

        var clean = html
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        // ── Strategy 1: JS file/source variables ─────────────────────────
        var jsPatterns = [
            /(?:file|src|source)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8|mkv)[^'"]{0,200})['"]/gi,
            /"(?:file|src|source)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]{0,200})"/gi,
            /var\s+\w+\s*=\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/gi
        ];
        jsPatterns.forEach(function (re) {
            var m;
            while ((m = re.exec(clean)) !== null) {
                var u = normaliseUrl(m[1]);
                if (u) { var q = guessQuality(u); if (!info.streams[q]) info.streams[q] = u; }
            }
        });

        // ── Strategy 2: sources[] array ──────────────────────────────────
        var srcBlock = clean.match(/sources\s*:\s*\[([\s\S]{0,3000}?)\]/i);
        if (srcBlock) {
            [
                /"(?:file|src)"\s*:\s*"([^"]+)"[^}]{0,300}"label"\s*:\s*"([^"]+)"/g,
                /"label"\s*:\s*"([^"]+)"[^}]{0,300}"(?:file|src)"\s*:\s*"([^"]+)"/g
            ].forEach(function (re, idx) {
                var pm;
                while ((pm = re.exec(srcBlock[1])) !== null) {
                    if (idx === 0) info.streams[pm[2]] = normaliseUrl(pm[1]);
                    else           info.streams[pm[1]] = normaliseUrl(pm[2]);
                }
            });
        }

        // ── Strategy 3: iframe embed ──────────────────────────────────────
        var embedHosts = 'collaps\\.to|cdn\\.collaps|delivembd\\.ws|kodik\\.info|kodik\\.cc|anifox|ashdi\\.vip|videocdn|cdnmovies|cdnvideohub|moonwalk|voidboost';
        var iframeRe = new RegExp(
            '<iframe[^>]+(?:src|data-src)=[\'"]' +
            '((?:https?:)?//(?:' + embedHosts + ')[^\'\"]{0,300})[\'"]',
            'i'
        );
        var im = iframeRe.exec(clean);
        if (!im) {
            im = /<iframe[^>]+(?:src|data-src)=['"]([^'"]+(?:\/embed\/|\/player\/|\/video\/|\/v\/)[^'"]{0,300})['"]/i.exec(clean);
        }
        if (im) {
            info.iframe = normaliseUrl(im[1]);
            log('Found iframe:', info.iframe);
        }

        // ── Strategy 4: playlist variable (TV series) ─────────────────────
        var plM = clean.match(/(?:var\s+)?playlist\s*=\s*(\[[\s\S]{0,30000}?\]);/i);
        if (plM) {
            try { parsePlaylist(JSON.parse(plM[1]), info.episodes); }
            catch (e) {
                try {
                    parsePlaylist(JSON.parse(plM[1].replace(/,\s*([}\]])/g, '$1')), info.episodes);
                } catch (e2) { log('playlist parse error:', e2.message); }
            }
        }

        log('parseMoviePage: streams=' + Object.keys(info.streams).length +
            ' iframe=' + (info.iframe ? '✓' : '✗') +
            ' episodes=' + info.episodes.length);
        return info;
    }

    function parsePlaylist(pl, out) {
        if (!Array.isArray(pl)) return;
        pl.forEach(function (ep, i) {
            out.push({
                season:  parseInt(ep.season,  10) || 1,
                episode: parseInt(ep.episode, 10) || (i + 1),
                title:   ep.title || ep.name  || '',
                url:     normaliseUrl(ep.file || ep.url || ep.hls || '')
            });
        });
    }

    // ─── EMBED DECODERS ────────────────────────────────────────────────────────

    function decodeCollaps(embedUrl, callback) {
        log('decodeCollaps', embedUrl);

        var idM = embedUrl.match(/\/(?:v|video|embed|e)\/([a-zA-Z0-9]+)/);
        if (idM) {
            fetchGet('https://api.collaps.to/api/source/' + idM[1], function (err, text) {
                var streams = {};
                if (!err && text) {
                    try {
                        var json = JSON.parse(text);
                        var sources = (json.data && json.data.sources) || json.sources || [];
                        sources.forEach(function (s) {
                            var u = normaliseUrl(s.file || s.url || '');
                            if (u) streams[s.label || s.quality || guessQuality(u)] = u;
                        });
                    } catch (e) {}
                }
                if (Object.keys(streams).length) { callback(null, streams); return; }
                scrapeForStreams(embedUrl, callback);
            });
        } else {
            scrapeForStreams(embedUrl, callback);
        }
    }

    function decodeKodik(embedUrl, callback) {
        log('decodeKodik', embedUrl);
        fetchGet(embedUrl, function (err, html) {
            if (err || !html) { callback(err, null); return; }

            var streams = {};
            scrapeVideoUrls(html, streams);
            if (Object.keys(streams).length) { callback(null, streams); return; }

            var tokenM = html.match(/['"]?token['"]?\s*[:=]\s*['"]([^'"]{6,})['"]/);
            var typeM  = html.match(/\/(?:seria|film|video|anime)\/(\d+)\//);
            if (!tokenM || !typeM) { callback(null, null); return; }

            postFetch('https://kodik.info/gvi',
                'id=' + typeM[1] + '&type=seria&hash=&season=1&episode=1&token=' + tokenM[1],
                function (perr, text) {
                    if (perr || !text) { callback(null, null); return; }
                    try {
                        var json = JSON.parse(text);
                        var links = json.links || {};
                        Object.keys(links).forEach(function (q) {
                            var link = Array.isArray(links[q]) ? links[q][0] : links[q];
                            var src  = normaliseUrl(link.src || link.url || link || '');
                            if (src) streams[q + 'p'] = src;
                        });
                    } catch (e) {}
                    callback(null, Object.keys(streams).length ? streams : null);
                }
            );
        });
    }

    function scrapeForStreams(url, callback) {
        fetchGet(url, function (err, html) {
            if (err || !html) { callback(err, null); return; }
            var streams = {};
            scrapeVideoUrls(html, streams);
            callback(null, Object.keys(streams).length ? streams : null);
        });
    }

    function scrapeVideoUrls(html, out) {
        var re = /['"]((https?:)?\/\/[^'"]{5,}\.(?:mp4|m3u8)[^'"]{0,200})['"]/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var u = normaliseUrl(m[1]);
            if (u) { var q = guessQuality(u); if (!out[q]) out[q] = u; }
        }
    }

    function extractStreams(html, pageUrl, callback) {
        var info = parseMoviePage(html);

        if (Object.keys(info.streams).length) {
            return callback(null, info.streams, info);
        }

        if (info.iframe) {
            var iurl = info.iframe;
            var decode;
            if (/collaps|delivembd/i.test(iurl))  decode = decodeCollaps;
            else if (/kodik/i.test(iurl))          decode = decodeKodik;
            else                                    decode = scrapeForStreams;

            decode(iurl, function (err, iStreams) {
                var merged = {};
                if (iStreams) Object.keys(iStreams).forEach(function (k) { merged[k] = iStreams[k]; });
                Object.keys(info.streams).forEach(function (k) { merged[k] = info.streams[k]; });
                callback(null, merged, info);
            });
            return;
        }

        callback(null, info.streams, info);
    }

    // ─── MATCHING ──────────────────────────────────────────────────────────────

    function bestMatch(results, movie) {
        var year = ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
        var names = [movie.title, movie.name, movie.original_title, movie.original_name]
            .filter(Boolean)
            .map(function (n) { return n.toLowerCase().trim(); });

        function wordOverlap(a, b) {
            var aw = a.split(/\W+/).filter(function (w) { return w.length > 2; });
            var bw = b.split(/\W+/).filter(function (w) { return w.length > 2; });
            return aw.filter(function (w) { return bw.indexOf(w) !== -1; }).length;
        }

        var scored = results.map(function (r) {
            var rt = r.title.toLowerCase().trim();
            var score = 0;
            names.forEach(function (n) {
                if (rt === n)                                            score += 20;
                else if (rt.indexOf(n) !== -1 || n.indexOf(rt) !== -1)  score += 10;
                else                                                     score += wordOverlap(rt, n) * 2;
            });
            if (year && r.year) {
                var diff = Math.abs(parseInt(r.year, 10) - parseInt(year, 10));
                if (diff === 0) score += 5;
                else if (diff <= 1) score += 2;
            }
            return { r: r, score: score };
        });

        return scored
            .filter(function (s) { return s.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .map(function (s) { return s.r; });
    }

    // ─── LOCALIZATION ──────────────────────────────────────────────────────────

    Lampa.Lang.add({
        uafix_searching:  { ru: 'Поиск на UAfix…',          uk: 'Пошук на UAfix…',          en: 'Searching UAfix…' },
        uafix_not_found:  { ru: 'Не найдено на UAfix',       uk: 'Не знайдено на UAfix',      en: 'Not found on UAfix' },
        uafix_error:      { ru: 'Ошибка загрузки',           uk: 'Помилка завантаження',      en: 'Load error' },
        uafix_no_streams: { ru: 'Видеопотоки не найдены',    uk: 'Відеопотоки не знайдено',   en: 'No video streams found' },
        uafix_select_q:   { ru: 'Выберите качество',         uk: 'Оберіть якість',            en: 'Select quality' },
        uafix_season:     { ru: 'Сезон',                     uk: 'Сезон',                     en: 'Season' },
        uafix_episode:    { ru: 'Серия',                     uk: 'Серія',                     en: 'Episode' },
        uafix_hint_proxy: { ru: 'Нет ответа? Укажите CORS-прокси в настройках UAfix',
                            uk: 'Немає відповіді? Вкажіть CORS-проксі у налаштуваннях UAfix',
                            en: 'No response? Set CORS proxy in UAfix settings' },
        uafix_set_domain: { ru: 'Домен сайта (зеркало)',     uk: 'Домен сайту (дзеркало)',    en: 'Site domain (mirror)' },
        uafix_set_proxy:  { ru: 'CORS-прокси URL',           uk: 'CORS-проксі URL',           en: 'CORS proxy URL' },
        uafix_set_q:      { ru: 'Предпочтительное качество', uk: 'Бажана якість',             en: 'Preferred quality' }
    });

    // ─── CSS ───────────────────────────────────────────────────────────────────

    (function () {
        var style = document.createElement('style');
        style.textContent = [
            '.uafix-wrap { display:flex; flex-direction:column; width:100%; height:100%; }',
            '.uafix-item { padding:0.8em 1.4em; border-bottom:1px solid rgba(255,255,255,0.07); cursor:pointer; }',
            '.uafix-item__name { font-size:1.2em; font-weight:600; }',
            '.uafix-item__sub  { font-size:0.9em; opacity:0.55; margin-top:0.2em; }',
            '.broadcast--uafix { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:1em; opacity:0.7; }',
            '.empty--uafix { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:0.6em; opacity:0.7; }'
        ].join('\n');
        document.head.appendChild(style);
    }());

    // ─── COMPONENT ─────────────────────────────────────────────────────────────

    function UafixComponent(object) {
        var self   = this;
        var movie  = object.movie;
        var scroll = null;
        var dead   = false;
        var lastFocus = false;

        self.el = document.createElement('div');
        self.el.className = 'uafix-wrap';

        function showLoader(text) {
            text = text || Lampa.Lang.translate('uafix_searching');
            destroyScroll();
            self.el.innerHTML =
                '<div class="broadcast--uafix">' +
                '<div class="broadcast__scan"><div></div><div></div><div></div></div>' +
                '<div class="broadcast__text">' + text + '</div>' +
                '</div>';
        }

        function showEmpty(text) {
            destroyScroll();
            self.el.innerHTML =
                '<div class="empty--uafix">' +
                '<div class="empty__ico"></div>' +
                '<div class="empty__text">' + text + '</div>' +
                '</div>';
        }

        function destroyScroll() {
            if (scroll) { try { scroll.destroy(); } catch (e) {} scroll = null; }
        }

        function buildList(items, emptyKey) {
            if (!items || !items.length) {
                showEmpty(Lampa.Lang.translate(emptyKey || 'uafix_not_found'));
                return;
            }

            destroyScroll();
            self.el.innerHTML = '';

            scroll = new Lampa.Scroll({ mask: true, over: true });
            try { scroll.body().addClass('uafix-list'); } catch (e) {}

            $(self.el).append(scroll.render());

            items.forEach(function (item) {
                var el = $('<div class="uafix-item selector"></div>');
                el.append($('<div class="uafix-item__name"></div>').text(item.title || ''));
                if (item.subtitle) {
                    el.append($('<div class="uafix-item__sub"></div>').text(item.subtitle));
                }

                el.on('hover:focus', function () {
                    lastFocus = this;
                    scroll.update($(this), true);
                });

                el.on('hover:enter click', function () {
                    if (item.onSelect) item.onSelect(item);
                });

                scroll.append(el);
            });

            focusFirst();
        }

        function focusFirst() {
            setTimeout(function () {
                if (dead || !scroll) return;
                Lampa.Controller.collectionSet(scroll.render());
                Lampa.Controller.collectionFocus(lastFocus || false, scroll.render());
            }, 60);
        }

        function launchPlayer(url, title) {
            log('launchPlayer:', url, title);
            try {
                if (typeof Lampa.Player !== 'undefined' && typeof Lampa.Player.play === 'function') {
                    Lampa.Player.play({ url: url, title: title });
                } else {
                    Lampa.Activity.push({ component: 'player', url: url, title: title });
                }
            } catch (e) {
                log('Player.play failed, fallback to Activity:', e);
                try { Lampa.Activity.push({ component: 'player', url: url, title: title }); } catch (e2) {}
            }
        }

        function playStream(streams, title) {
            var keys = Object.keys(streams);
            if (!keys.length) { showEmpty(Lampa.Lang.translate('uafix_no_streams')); return; }
            if (keys.length === 1) { launchPlayer(streams[keys[0]], title); return; }

            var pref = Lampa.Storage.get('uafix_quality', 'auto');
            if (pref !== 'auto') {
                var prefKey = safeFind(keys, function (k) { return k.indexOf(pref) !== -1; });
                if (prefKey) { launchPlayer(streams[prefKey], title); return; }
            }

            var order = ['2160p', '1080p', '720p', '480p', '360p', 'HLS', 'Auto'];
            var best = safeFind(order, function (q) { return !!streams[q]; });
            if (best) { launchPlayer(streams[best], title); return; }

            Lampa.Select.show({
                title:    Lampa.Lang.translate('uafix_select_q'),
                items:    keys.map(function (q) { return { title: q, url: streams[q] }; }),
                onSelect: function (itm) { launchPlayer(itm.url, title); },
                onBack:   function () { Lampa.Controller.toggle('content'); }
            });
        }

        function showEpisodeList(eps, baseTitle, season) {
            var items = eps.map(function (ep) {
                var playTitle = baseTitle + ' S' + pad(season) + 'E' + pad(ep.episode);
                return {
                    title: Lampa.Lang.translate('uafix_episode') + ' ' + ep.episode +
                           (ep.title ? ' — ' + ep.title : ''),
                    onSelect: function () {
                        if (ep.url) playStream({ Auto: ep.url }, playTitle);
                        else        Lampa.Noty.show(Lampa.Lang.translate('uafix_no_streams'));
                    }
                };
            });
            buildList(items);
        }

        function showSeasonMenu(pageInfo, baseTitle) {
            var eps = pageInfo.episodes;
            if (!eps || !eps.length) {
                if (Object.keys(pageInfo.streams).length) { playStream(pageInfo.streams, baseTitle); return; }
                showEmpty(Lampa.Lang.translate('uafix_not_found'));
                return;
            }

            var seasons = {};
            eps.forEach(function (ep) {
                var s = ep.season || 1;
                if (!seasons[s]) seasons[s] = [];
                seasons[s].push(ep);
            });
            var nums = Object.keys(seasons).sort(function (a, b) { return a - b; });

            if (nums.length === 1) { showEpisodeList(seasons[nums[0]], baseTitle, nums[0]); return; }

            var items = nums.map(function (s) {
                return {
                    title:    Lampa.Lang.translate('uafix_season') + ' ' + s,
                    subtitle: seasons[s].length + ' ' + Lampa.Lang.translate('uafix_episode').toLowerCase(),
                    onSelect: function () { showEpisodeList(seasons[s], baseTitle, s); }
                };
            });
            buildList(items);
        }

        function pad(n) { return n < 10 ? '0' + n : '' + n; }

        function loadPage(url, title) {
            showLoader();
            request(url, function (err, html) {
                if (dead) return;
                if (err || !html) {
                    log('loadPage error:', err);
                    showEmpty(Lampa.Lang.translate('uafix_error') + '. ' + Lampa.Lang.translate('uafix_hint_proxy'));
                    return;
                }

                html = stripAds(html);
                extractStreams(html, url, function (err2, streams, pageInfo) {
                    if (dead) return;

                    var isTV = (movie.media_type === 'tv') || !!(movie.number_of_seasons);
                    if (isTV && pageInfo.episodes && pageInfo.episodes.length) {
                        showSeasonMenu(pageInfo, title);
                    } else if (Object.keys(streams).length) {
                        playStream(streams, title);
                    } else if (pageInfo.iframe) {
                        showEmpty(Lampa.Lang.translate('uafix_no_streams') + '. ' + Lampa.Lang.translate('uafix_hint_proxy'));
                    } else {
                        showEmpty(Lampa.Lang.translate('uafix_not_found'));
                    }
                });
            });
        }

        function handleResults(results) {
            var baseTitle = movie.title || movie.name || '';
            if (results.length === 1) { loadPage(results[0].url, results[0].title || baseTitle); return; }

            var items = results.map(function (r) {
                return {
                    title:    r.title,
                    subtitle: r.year || '',
                    onSelect: function () { loadPage(r.url, r.title || baseTitle); }
                };
            });
            buildList(items);
        }

        function searchWith(query, onEmpty) {
            var domain = getDomain();
            var url = domain + '/search.html?do=search&subaction=search&story=' + encodeURIComponent(query);
            log('Searching for:', query, '→', url);

            request(url, function (err, html) {
                if (dead) return;
                if (err || !html) {
                    log('Search error:', err);
                    showEmpty(Lampa.Lang.translate('uafix_error') + '. ' + Lampa.Lang.translate('uafix_hint_proxy'));
                    return;
                }

                log('Search HTML length:', html.length);
                log('Search HTML snippet:', html.slice(0, 500));
                html = stripAds(html);

                var results = parseSearchResults(html, domain);
                var matched = bestMatch(results, movie);
                log('Results:', results.length, '→ Matched:', matched.length, matched.slice(0, 3));

                if (matched.length) { handleResults(matched); }
                else if (onEmpty)    { onEmpty(); }
                else                 { showEmpty(Lampa.Lang.translate('uafix_not_found')); }
            });
        }

        function startSearch() {
            showLoader();
            var titleMain = movie.title || movie.name || '';
            var titleOrig = movie.original_title || movie.original_name || '';

            log('Movie:', JSON.stringify({
                title:          movie.title,
                name:           movie.name,
                original_title: movie.original_title,
                original_name:  movie.original_name,
                media_type:     movie.media_type,
                release_date:   movie.release_date,
                first_air_date: movie.first_air_date
            }));

            searchWith(titleMain, function () {
                if (titleOrig && titleOrig.toLowerCase() !== titleMain.toLowerCase()) {
                    searchWith(titleOrig, null);
                } else {
                    showEmpty(Lampa.Lang.translate('uafix_not_found'));
                }
            });
        }

        this.create = function () {
            startSearch();
            return self.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    if (scroll) {
                        Lampa.Controller.collectionSet(scroll.render());
                        Lampa.Controller.collectionFocus(lastFocus || false, scroll.render());
                    }
                },
                back:  function () { Lampa.Activity.backward(); },
                up:    function () { if (scroll) scroll.wheel(-200); },
                down:  function () { if (scroll) scroll.wheel(200);  },
                left:  function () { Lampa.Controller.toggle('menu'); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function () {};
        this.stop    = function () {};

        this.destroy = function () {
            dead = true;
            destroyScroll();
            self.el.innerHTML = '';
        };

        this.render = function () { return self.el; };
    }

    Lampa.Component.add(PLUGIN_NAME, UafixComponent);

    // ─── BUTTON ON CARD ────────────────────────────────────────────────────────

    Lampa.Listener.follow('full', function (e) {
        if (e.type !== 'complite') return;

        var movie = (e.object && e.object.activity && e.object.activity.movie)
                 || (e.object && e.object.movie)
                 || (e.data && e.data.movie)
                 || (e.object && e.object.card)
                 || {};

        if (!movie || (!movie.title && !movie.name)) {
            log('full complite: no movie data found, e.data=', e.data, 'e.object=', e.object);
            return;
        }

        try {
            var btn = $('<div class="full-start__button selector view--uafix">' +
                '<div class="full-start__button-icon">' +
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">' +
                '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10' +
                ' 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>' +
                '</svg></div>' +
                '<div class="full-start__button-text">UAfix</div>' +
                '</div>');

            btn.on('hover:enter click', function () {
                Lampa.Activity.push({
                    component: PLUGIN_NAME,
                    movie:     movie,
                    title:     'UAfix — ' + (movie.title || movie.name || movie.original_title || '')
                });
            });

            var injected = false;

            if (!injected && e.object && typeof e.object.append === 'function') {
                e.object.prepend(btn);
                injected = true;
                log('Button injected via e.object.append()');
            }

            if (!injected && e.object && e.object.activity && typeof e.object.activity.append === 'function') {
                e.object.activity.prepend(btn);
                injected = true;
                log('Button injected via e.object.activity.append()');
            }

            if (!injected) {
                var btnsArea = $(document).find('.activity--active .full-start__buttons, .activity--active .full-start-new__buttons').first();
                if (btnsArea.length) {
                    btnsArea.prepend(btn);
                    injected = true;
                    log('Button injected via DOM query');
                }
            }

            if (!injected && e.body) {
                var bodyBtns = $(e.body).find('.full-start__buttons, .full-start-new__buttons');
                if (bodyBtns.length) {
                    bodyBtns.prepend(btn);
                    injected = true;
                    log('Button injected via e.body');
                }
            }

            if (!injected) {
                log('WARNING: Could not inject button. e keys:', Object.keys(e));
            }

        } catch (err) {
            log('Button inject error:', err);
        }
    });

    // ─── SETTINGS ──────────────────────────────────────────────────────────────

    function setupSettings() {
        if (Lampa.SettingsApi) {
            try {
                Lampa.SettingsApi.addComponent({
                    component: PLUGIN_NAME,
                    name:      'UAfix',
                    icon:      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>'
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_NAME,
                    param:  { name: 'uafix_domain', type: 'input', default: DEFAULT_HOST },
                    field:  { name: Lampa.Lang.translate('uafix_set_domain'), description: DEFAULT_HOST },
                    onChange: function (v) { Lampa.Storage.set('uafix_domain', v); }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_NAME,
                    param:  { name: 'uafix_proxy', type: 'input', default: 'https://api.cors.lol/?url=' },
                    field:  { name: Lampa.Lang.translate('uafix_set_proxy'), description: 'https://api.cors.lol/?url=' },
                    onChange: function (v) { Lampa.Storage.set('uafix_proxy', v); }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_NAME,
                    param:  { name: 'uafix_quality', type: 'select', default: 'auto',
                              values: { auto: 'Авто', '1080': '1080p', '720': '720p', '480': '480p' } },
                    field:  { name: Lampa.Lang.translate('uafix_set_q') },
                    onChange: function (v) { Lampa.Storage.set('uafix_quality', v); }
                });
                log('Settings → SettingsApi ✓');
                return;
            } catch (e) { log('SettingsApi err:', e); }
        }

        if (Lampa.Params) {
            try {
                Lampa.Params.select('uafix_quality', {
                    values:  { auto: 'Авто', '1080': '1080p', '720': '720p', '480': '480p' },
                    default: 'auto'
                });
                log('Settings → Lampa.Params ✓');
            } catch (e) { log('Params err:', e); }
        }
    }

    Lampa.Listener.follow('app:ready', setupSettings);

    log('Plugin loaded v0.3 ✓');

})();
