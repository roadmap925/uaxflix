/**
 * UAfix — Lampa plugin for uafix.net
 * Adds a "UAfix" button to film/series cards and streams content via uafix.net
 *
 * Install: add this file's URL in Lampa → Extensions
 */
(function () {
    'use strict';

    // ─── CONFIG ────────────────────────────────────────────────────────────────
    var PLUGIN_NAME  = 'uafix';
    var DEFAULT_HOST = 'https://uafix.net';

    // ─── UTILITIES ─────────────────────────────────────────────────────────────

    function log() {
        var a = Array.prototype.slice.call(arguments);
        a.unshift('[UAfix]');
        console.log.apply(console, a);
    }

    function getDomain() {
        return (Lampa.Storage.get('uafix_domain', DEFAULT_HOST) || DEFAULT_HOST).replace(/\/$/, '');
    }

    function getProxy() {
        return Lampa.Storage.get('uafix_proxy', '') || '';
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

    function escapeRe(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ─── NETWORK ───────────────────────────────────────────────────────────────

    /**
     * GET url → callback(err, text)
     * Tries Lampa.Reguest first (native Android bypass), falls back to fetch().
     */
    function request(url, callback, timeout) {
        timeout = timeout || 15000;
        var finalUrl = withProxy(url);
        log('GET', finalUrl);

        var timer;
        var settled = false;

        function settle(err, text) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(err, text);
        }

        // ── Attempt 1: Lampa.Reguest (bypasses CORS on Android WebView) ──
        var network;
        try {
            network = new Lampa.Reguest();
            timer = setTimeout(function () {
                try { network.clear(); } catch (e) {}
                // On timeout fall through to fetch
                fetchGet(url, callback, timeout);
                settled = true; // prevent double-callback
            }, timeout);

            network.silent(finalUrl, function (text) {
                settle(null, text);
            }, function () {
                // Lampa.Reguest failed → try fetch
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    fetchGet(url, callback, timeout);
                }
            }, false, { dataType: 'text' });

            return;
        } catch (e) {
            clearTimeout(timer);
            log('Lampa.Reguest unavailable, using fetch');
        }

        // ── Attempt 2: fetch ──
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
                settle(new Error('Timeout'), null);
            }, timeout);
        } catch (e) {}

        var opts = { method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
        if (controller) opts.signal = controller.signal;

        fetch(finalUrl, opts)
            .then(function (r) { clearTimeout(timer); return r.text(); })
            .then(function (t) { settle(null, t); })
            .catch(function (e) { settle(e, null); });
    }

    function postFetch(url, body, callback, timeout) {
        timeout = timeout || 15000;
        log('POST', withProxy(url));

        fetch(withProxy(url), {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
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

        function add(url, rawTitle, rawYear) {
            if (!url || !rawTitle) return;
            if (url.charAt(0) === '/') url = domain + url;
            if (/do=search|\/categor|\/tag|\.xml|\/page\//i.test(url)) return;
            // Only accept URLs that look like article/film pages (at least one path segment after host)
            var path = url.replace(/^https?:\/\/[^/]+/, '');
            if (!path || path === '/' || path.split('/').filter(Boolean).length < 1) return;
            if (results.some(function (r) { return r.url === url; })) return;

            var year = (rawYear || '').toString();
            var yM = year.match(/\b(19|20)\d{2}\b/);
            year = yM ? yM[0] : '';

            var title = rawTitle.replace(/\(\d{4}\)/g, '').replace(/\s+/g, ' ').trim();
            if (title.length < 2) return;
            results.push({ url: url, title: title, year: year });
        }

        // Strategy 1: article / DLE short-story blocks
        var blockTokens = html.split(/<(?:article|div)[^>]+class="[^"]*(?:short[_-]?news|shortstory|news[_-]?item|search[_-]?result|mov(?:ie)?[_-]?item|dle-content)[^"]*"[^>]*>/i);
        for (var bi = 1; bi < blockTokens.length; bi++) {
            var block = blockTokens[bi].split(/<\/(?:article|div)>/)[0];
            var linkM = /<a[^>]+href="([^"]+)"[^>]*>([^<]{2,})<\/a>/i.exec(block);
            if (linkM) {
                var ymatch = block.match(/\b(19|20)\d{2}\b/);
                add(linkM[1], linkM[2], ymatch ? ymatch[0] : '');
            }
        }

        // Strategy 2: heading-linked titles (h1/h2/h3 inside article)
        var headRe = /<h[123][^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]{2,})<\/a>[\s\S]*?<\/h[123]>/gi;
        var hm;
        while ((hm = headRe.exec(html)) !== null) {
            var ymH = html.slice(hm.index, hm.index + 300).match(/\b(19|20)\d{2}\b/);
            add(hm[1], hm[2], ymH ? ymH[0] : '');
        }

        // Strategy 3: domain-anchored link scan (fallback)
        if (results.length === 0) {
            var domEsc = escapeRe(domain.replace(/^https?:\/\//, ''));
            var linkRe = new RegExp(
                '<a[^>]+href="(https?://' + domEsc + '/[^"?#]{3,})"[^>]*>([^<]{3,})</a>',
                'gi'
            );
            var lm;
            while ((lm = linkRe.exec(html)) !== null) {
                var ymL = lm[1].match(/\b(19|20)\d{2}\b/);
                add(lm[1], lm[2], ymL ? ymL[0] : '');
            }
        }

        log('parseSearchResults → ' + results.length + ' results');
        return results;
    }

    function guessQuality(url) {
        if (/2160|4k/i.test(url)) return '2160p';
        if (/1080/.test(url))     return '1080p';
        if (/720/.test(url))      return '720p';
        if (/480/.test(url))      return '480p';
        if (/360/.test(url))      return '360p';
        if (/\.m3u8/.test(url))   return 'HLS';
        return 'Auto';
    }

    function parseMoviePage(html) {
        var info = { title: '', iframe: '', streams: {}, episodes: [] };

        var tM = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (tM) info.title = tM[1].trim();

        // ── Strategy 1: JS source variables ─────────────────────────────
        [
            /(?:file|src|source|url)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8|mkv)[^'"]{0,200})['"]/gi,
            /"(?:file|src|source|url)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]{0,200})"/gi,
            /var\s+\w+\s*=\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/gi
        ].forEach(function (re) {
            var m;
            while ((m = re.exec(html)) !== null) {
                var u = normaliseUrl(m[1]);
                if (u && !info.streams[guessQuality(u)]) info.streams[guessQuality(u)] = u;
            }
        });

        // ── Strategy 2: sources[] block ──────────────────────────────────
        var srcBlock = html.match(/sources\s*:\s*\[([\s\S]{0,3000}?)\]/i);
        if (srcBlock) {
            var p1 = /"(?:file|src)"\s*:\s*"([^"]+)"[^}]{0,200}"label"\s*:\s*"([^"]+)"/g;
            var p2 = /"label"\s*:\s*"([^"]+)"[^}]{0,200}"(?:file|src)"\s*:\s*"([^"]+)"/g;
            var pm;
            while ((pm = p1.exec(srcBlock[1])) !== null) info.streams[pm[2]] = normaliseUrl(pm[1]);
            while ((pm = p2.exec(srcBlock[1])) !== null) info.streams[pm[1]] = normaliseUrl(pm[2]);
        }

        // ── Strategy 3: iframe embed ─────────────────────────────────────
        var embedHosts = 'collaps\\.to|cdn\\.collaps|delivembd\\.ws|kodik\\.info|kodik\\.cc|anifox|ashdi\\.vip|videocdn|cdnmovies|cdnvideohub|moonwalk|iframe\\.video|voidboost';
        var iframeRe = new RegExp(
            '<iframe[^>]+(?:src|data-src)=[\'"]' +
            '((?:https?:)?//(?:' + embedHosts + ')[^\'\"]{0,300})[\'"]',
            'i'
        );
        var im = iframeRe.exec(html);
        if (!im) {
            im = /<iframe[^>]+(?:src|data-src)=['"]([^'"]+(?:\/embed\/|\/player\/|\/video\/|\/v\/)[^'"]{0,300})['"]/i.exec(html);
        }
        if (im) {
            info.iframe = normaliseUrl(im[1]);
            log('Found iframe:', info.iframe);
        }

        // ── Strategy 4: playlist JS variable (TV series) ─────────────────
        var plM = html.match(/(?:var\s+)?playlist\s*=\s*(\[[\s\S]{0,30000}?\]);/i);
        if (plM) {
            // Attempt 1: raw JSON parse
            try {
                var pl = JSON.parse(plM[1]);
                if (Array.isArray(pl)) parsePlaylist(pl, info.episodes);
            } catch (e) {
                // Attempt 2: light single→double quote fix (avoids breaking URLs)
                try {
                    var raw2 = plM[1].replace(/,\s*([}\]])/g, '$1');
                    var pl2  = JSON.parse(raw2);
                    if (Array.isArray(pl2)) parsePlaylist(pl2, info.episodes);
                } catch (e2) {
                    log('playlist parse error:', e2.message);
                }
            }
        }

        log('parseMoviePage: streams=' + Object.keys(info.streams).length +
            ' iframe=' + (info.iframe ? '✓' : '✗') +
            ' episodes=' + info.episodes.length);
        return info;
    }

    function normaliseUrl(u) {
        if (!u) return '';
        u = u.trim();
        if (u.indexOf('//') === 0) return 'https:' + u;
        return u;
    }

    function parsePlaylist(pl, out) {
        pl.forEach(function (ep, i) {
            out.push({
                season:  parseInt(ep.season, 10)  || 1,
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
            var apiUrl = 'https://api.collaps.to/api/source/' + idM[1];
            fetchGet(apiUrl, function (err, text) {
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

            // Kodik API /gvi
            var tokenM = html.match(/['"]?token['"]?\s*[:=]\s*['"]([^'"]{6,})['"]/);
            var typeM  = html.match(/\/(?:seria|film|video|anime)\/(\d+)\//);
            if (!tokenM || !typeM) { callback(null, null); return; }

            var body = 'id=' + typeM[1] + '&type=seria&hash=&season=1&episode=1&token=' + tokenM[1];
            postFetch('https://kodik.info/gvi', body, function (perr, text) {
                if (perr || !text) { callback(null, null); return; }
                try {
                    var json = JSON.parse(text);
                    var links = json.links || {};
                    Object.keys(links).forEach(function (q) {
                        var link = Array.isArray(links[q]) ? links[q][0] : links[q];
                        var src = normaliseUrl(link.src || link.url || link || '');
                        if (src) streams[q + 'p'] = src;
                    });
                } catch (e) {}
                callback(null, Object.keys(streams).length ? streams : null);
            });
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
            if (u && !out[guessQuality(u)]) out[guessQuality(u)] = u;
        }
    }

    /**
     * Full extraction pipeline: parse page → decode embed → callback(err, streams, info)
     */
    function extractStreams(html, pageUrl, callback) {
        var info = parseMoviePage(html);

        if (Object.keys(info.streams).length) {
            return callback(null, info.streams, info);
        }

        if (info.iframe) {
            var iurl = info.iframe;
            var decode;
            if (/collaps|delivembd/i.test(iurl)) decode = decodeCollaps;
            else if (/kodik/i.test(iurl))        decode = decodeKodik;
            else                                  decode = scrapeForStreams;

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
                if (rt === n)                                   score += 20;
                else if (rt.indexOf(n) !== -1 || n.indexOf(rt) !== -1) score += 10;
                else                                            score += wordOverlap(rt, n) * 2;
            });
            if (year && r.year) {
                var diff = Math.abs(parseInt(r.year, 10) - parseInt(year, 10));
                if (diff === 0) score += 5;
                else if (diff === 1) score += 2;
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
        uafix_no_streams: { ru: 'Видеопотоки не найдены',   uk: 'Відеопотоки не знайдено',   en: 'No video streams found' },
        uafix_select_src: { ru: 'Выберите источник',         uk: 'Оберіть джерело',           en: 'Select source' },
        uafix_select_q:   { ru: 'Выберите качество',         uk: 'Оберіть якість',            en: 'Select quality' },
        uafix_select_s:   { ru: 'Выберите сезон',            uk: 'Оберіть сезон',             en: 'Select season' },
        uafix_select_ep:  { ru: 'Выберите серию',            uk: 'Оберіть серію',             en: 'Select episode' },
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

    var style = document.createElement('style');
    style.textContent = [
        '.uafix-wrap { display:flex; flex-direction:column; width:100%; height:100%; }',
        '.uafix-wrap .uafix-item { padding:0.8em 1.4em; border-bottom:1px solid rgba(255,255,255,0.06); }',
        '.uafix-wrap .uafix-item__name { font-size:1.2em; font-weight:600; }',
        '.uafix-wrap .uafix-item__sub  { font-size:0.9em; opacity:0.6; margin-top:0.2em; }',
        '.uafix-wrap .uafix-item.focus { background:rgba(255,255,255,0.12); }',
        '.uafix-wrap .broadcast--empty { display:flex; flex-direction:column; align-items:center;',
        '  justify-content:center; height:100%; gap:1em; opacity:0.7; }',
        '.uafix-wrap .empty { display:flex; flex-direction:column; align-items:center;',
        '  justify-content:center; height:100%; gap:1em; opacity:0.7; }'
    ].join('\n');
    document.head.appendChild(style);

    // ─── COMPONENT ─────────────────────────────────────────────────────────────

    function UafixComponent(object) {
        var self   = this;
        var movie  = object.movie;
        var scroll = null;
        var dead   = false;

        self.el = document.createElement('div');
        self.el.className = 'uafix-wrap';

        // ── DOM helpers ───────────────────────────────────────────────

        function setContent(html) { self.el.innerHTML = html; }

        function showLoader(text) {
            text = text || Lampa.Lang.translate('uafix_searching');
            setContent(
                '<div class="broadcast--empty">' +
                '<div class="broadcast__scan"><div></div><div></div><div></div></div>' +
                '<div class="broadcast__text">' + text + '</div>' +
                '</div>'
            );
        }

        function showEmpty(text) {
            setContent(
                '<div class="empty">' +
                '<div class="empty__ico"></div>' +
                '<div class="empty__text">' + text + '</div>' +
                '</div>'
            );
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
            scroll = new Lampa.Scroll({ horizontal: false, nopadding: true });
            self.el.appendChild(scroll.render(true));

            items.forEach(function (item) {
                var el = document.createElement('div');
                el.className = 'uafix-item selector';
                el.innerHTML =
                    '<div class="uafix-item__name">' + (item.title || '') + '</div>' +
                    (item.subtitle ? '<div class="uafix-item__sub">' + item.subtitle + '</div>' : '');

                el.addEventListener('hover:enter', function () {
                    if (item.onSelect) item.onSelect(item);
                });

                scroll.append(el);
            });

            focusFirst();
        }

        function focusFirst() {
            setTimeout(function () {
                if (!dead) {
                    Lampa.Controller.collectionSet(self.el);
                    Lampa.Controller.collectionFocus(false, self.el);
                }
            }, 60);
        }

        // ── Playback ──────────────────────────────────────────────────

        function playStream(streams, title) {
            var keys = Object.keys(streams);
            if (!keys.length) { showEmpty(Lampa.Lang.translate('uafix_no_streams')); return; }
            if (keys.length === 1) { Lampa.Player.play({ url: streams[keys[0]], title: title }); return; }

            var pref = Lampa.Storage.get('uafix_quality', 'auto');
            if (pref !== 'auto') {
                var prefKey = safeFind(keys, function (k) { return k.indexOf(pref) !== -1; });
                if (prefKey) { Lampa.Player.play({ url: streams[prefKey], title: title }); return; }
            }

            // Auto: pick best available
            var order = ['2160p', '1080p', '720p', '480p', '360p', 'HLS', 'Auto'];
            var best = safeFind(order, function (q) { return !!streams[q]; });
            if (best) { Lampa.Player.play({ url: streams[best], title: title }); return; }

            // Fallback to quality picker
            Lampa.Select.show({
                title:    Lampa.Lang.translate('uafix_select_q'),
                items:    keys.map(function (q) { return { title: q, url: streams[q] }; }),
                onSelect: function (itm) { Lampa.Player.play({ url: itm.url, title: title }); },
                onBack:   function () { Lampa.Controller.toggle(PLUGIN_NAME); }
            });
        }

        // ── Episode / season navigation ───────────────────────────────

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
                if (Object.keys(pageInfo.streams).length) playStream(pageInfo.streams, baseTitle);
                else showEmpty(Lampa.Lang.translate('uafix_not_found'));
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
                    subtitle: seasons[s].length + ' ' + Lampa.Lang.translate('uafix_episode').toLowerCase() + (seasons[s].length !== 1 ? 'й' : 'я'),
                    onSelect: function () { showEpisodeList(seasons[s], baseTitle, s); }
                };
            });
            buildList(items);
        }

        function pad(n) { return n < 10 ? '0' + n : '' + n; }

        // ── Page loading ──────────────────────────────────────────────

        function loadPage(url, title) {
            showLoader();
            request(url, function (err, html) {
                if (dead) return;
                if (err || !html) {
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

        // ── Search ────────────────────────────────────────────────────

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
            var url = domain + '/?do=search&subaction=search&story=' + encodeURIComponent(query);
            log('Search query:', query);

            request(url, function (err, html) {
                if (dead) return;
                if (err || !html) {
                    showEmpty(Lampa.Lang.translate('uafix_error') + '. ' + Lampa.Lang.translate('uafix_hint_proxy'));
                    return;
                }

                html = stripAds(html);
                var results = parseSearchResults(html, domain);
                var matched = bestMatch(results, movie);
                log('Matched ' + matched.length + ' of ' + results.length + ' results for "' + query + '"');

                if (matched.length) handleResults(matched);
                else if (onEmpty)    onEmpty();
                else                 showEmpty(Lampa.Lang.translate('uafix_not_found'));
            });
        }

        function startSearch() {
            showLoader();
            var titleMain = movie.title || movie.name || '';
            var titleOrig = movie.original_title || movie.original_name || '';

            searchWith(titleMain, function () {
                if (titleOrig && titleOrig.toLowerCase() !== titleMain.toLowerCase()) {
                    searchWith(titleOrig, null);
                } else {
                    showEmpty(Lampa.Lang.translate('uafix_not_found'));
                }
            });
        }

        // ── Lifecycle ─────────────────────────────────────────────────

        this.create = function () {
            startSearch();
            return self.render();
        };

        this.start = function () {
            Lampa.Controller.add(PLUGIN_NAME, {
                toggle: function () {
                    Lampa.Controller.collectionSet(self.el);
                    Lampa.Controller.collectionFocus(false, self.el);
                },
                back:  function () { Lampa.Activity.backward(); },
                up:    function () { if (scroll) scroll.wheel(-200); },
                down:  function () { if (scroll) scroll.wheel(200);  },
                left:  function () { Lampa.Controller.toggle('menu'); }
            });
            Lampa.Controller.toggle(PLUGIN_NAME);
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

        try {
            var btn = $('<div class="view--uafix selector">' +
                '<div class="view__icon">' +
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
                '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10' +
                ' 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>' +
                '</svg>' +
                '</div>' +
                '<div class="view__name">UAfix</div>' +
                '</div>');

            btn.on('hover:enter', function () {
                var actMovie = e.object.activity.movie;
                Lampa.Activity.push({
                    component: PLUGIN_NAME,
                    movie:     actMovie,
                    title:     'UAfix — ' + (actMovie.title || actMovie.name || actMovie.original_title || '')
                });
            });

            e.object.activity.append(btn);
        } catch (err) {
            log('Button inject error:', err);
        }
    });

    // ─── SETTINGS ──────────────────────────────────────────────────────────────

    function setupSettings() {
        // Modern API (Lampa ≥ 2023)
        if (Lampa.SettingsApi) {
            try {
                Lampa.SettingsApi.addComponent({
                    component: PLUGIN_NAME,
                    name:      'UAfix',
                    icon:      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>'
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_NAME,
                    param:  { name: 'uafix_domain',  type: 'input',  default: DEFAULT_HOST },
                    field:  { name: Lampa.Lang.translate('uafix_set_domain'), description: DEFAULT_HOST },
                    onChange: function (v) { Lampa.Storage.set('uafix_domain', v); }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_NAME,
                    param:  { name: 'uafix_proxy',   type: 'input',  default: '' },
                    field:  { name: Lampa.Lang.translate('uafix_set_proxy'), description: 'https://cors.proxy/?url=' },
                    onChange: function (v) { Lampa.Storage.set('uafix_proxy', v); }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_NAME,
                    param:  { name: 'uafix_quality', type: 'select', default: 'auto',
                              values: { auto: 'Авто', '1080': '1080p', '720': '720p', '480': '480p' } },
                    field:  { name: Lampa.Lang.translate('uafix_set_q') },
                    onChange: function (v) { Lampa.Storage.set('uafix_quality', v); }
                });
                log('Settings → SettingsApi');
                return;
            } catch (e) { log('SettingsApi err:', e); }
        }

        // Legacy fallback
        if (Lampa.Params) {
            try {
                Lampa.Params.select('uafix_quality', {
                    values:  { auto: 'Авто', '1080': '1080p', '720': '720p', '480': '480p' },
                    default: 'auto'
                });
                log('Settings → Lampa.Params');
            } catch (e) { log('Params err:', e); }
        }
    }

    if (Lampa.Listener) Lampa.Listener.follow('app:ready', setupSettings);
    try { setupSettings(); } catch (e) {}

    log('Plugin ready ✓');

})();
