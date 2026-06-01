(function () {
  'use strict';

  function _classCallCheck(a, n) {
    if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
  }
  function _defineProperties(e, r) {
    for (var t = 0; t < r.length; t++) {
      var o = r[t];
      o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
    }
  }
  function _createClass(e, r, t) {
    return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
  }
  function _toPrimitive(t, r) {
    if ("object" != typeof t || !t) return t;
    var e = t[Symbol.toPrimitive];
    if (void 0 !== e) {
      var i = e.call(t, r || "default");
      if ("object" != typeof i) return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return ("string" === r ? String : Number)(t);
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return "symbol" == typeof i ? i : i + "";
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) {
      return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
    }, _typeof(o);
  }

  function normalizeErrorCode(json) {
    return json && (json.error_code || json.meta && json.meta.code) || '';
  }
  function extractErrorText(json) {
    return json && (json.error || json.message || json.error_code) || '';
  }
  var DISABLED_SOURCE_CODES = {
    NOT_FOUND: true, CONTENT_REMOVED: true, UNAUTHORIZED: true, INVALID_AUTH: true,
    MISSING_IMDB_OR_TMDB: true, INVALID_TMDB_ID: true, INVALID_SERIAL: true,
    NO_PLAYER_DATA: true, NO_STREAM_DATA: true, NO_STREAMS: true, NO_STREAM: true,
    NO_MOVIE_STREAM: true, NO_MOVIE_STREAMS: true, NO_EPISODES: true, NO_VOICES: true,
    NO_SERIAL_STRUCTURE: true, NO_ANIME_INFO: true, NO_ANIME_STRUCTURE: true, VOICE_NOT_FOUND: true
  };

  function createV2(sourceKey) {
    return function v2(component, _object) {
      var api_client = component.api_client;
      var object = _object;
      var selected = null;
      var series = null;
      var episodes_cache = {};
      var stream_cache = {};
      var content_ref = null;
      var lazy_state = createLazyState();
      var filter_items = { season: [], voice: [] };
      var choice = { season: 0, voice: 0, voice_name: '' };

      this.searchByTitle = function (_object, title) { object = _object; search({ title: title }); };
      this.searchByImdbID = function (_object, imdb_id) { object = _object; search({ imdb_id: imdb_id }); };
      this.searchByKinopoisk = function (_object, kinopoisk_id) { object = _object; search({ kinopoisk_id: kinopoisk_id }); };
      this.searchByMalId = function (_object, mal_id) { object = _object; search({ mal_id: mal_id }); };
      this.search = function (_object, data) {
        object = _object;
        if (!data || !data.length) return component.doesNotAnswer();
        var first = data[0] || {};
        if (first.ref) { selected = first; loadContent(first.ref); return; }
        search({
          title: first.title || first.name || object.movie.title || object.movie.name,
          original_title: first.orig_title || first.original_title || first.nameEn || object.movie.original_title || object.movie.original_name,
          imdb_id: first.imdb_id, tmdb_id: first.tmdb_id,
          kinopoisk_id: first.kp_id || first.kinopoisk_id || first.filmId,
          mal_id: first.mal_id || first.malId || object.movie.mal_id,
          year: getYear(object.movie || {}),
          serial: typeof first.serial != 'undefined' ? first.serial : getSerial(object.movie || {})
        });
      };
      this.extendChoice = function (saved) { Lampa.Arrays.extend(choice, saved, true); };
      this.reset = function () {
        component.reset(); choice = { season: 0, voice: 0, voice_name: '' };
        filter(); buildEpisodes();
      };
      this.filter = function (type, a, b) {
        choice[a.stype] = b.index;
        if (a.stype == 'voice' && filter_items.voice[b.index]) choice.voice_name = filter_items.voice[b.index];
        component.reset(); filter(); buildEpisodes();
      };
      this.cancel = function () { api_client.clear(); };
      this.destroy = function () {
        api_client.clear(); selected = null; series = null;
        episodes_cache = {}; content_ref = null; lazy_state = createLazyState();
      };

      function handleSourceError(json) {
        var code = normalizeErrorCode(json);
        var text = extractErrorText(json) || code;
        if (code && DISABLED_SOURCE_CODES[code]) { component.disableSource(sourceKey, code); component.empty(); return; }
        if (text) component.pushError(text);
        component.empty();
      }
      function handleStreamError(json) {
        var code = normalizeErrorCode(json);
        var text = extractErrorText(json);
        if (code && DISABLED_SOURCE_CODES[code]) component.disableSource(sourceKey, code);
        if (text) component.pushError(text);
      }
      function getYear(movie) {
        var date = movie.release_date || movie.first_air_date || movie.year || movie.start_date;
        return date ? (date + '').slice(0, 4) : '';
      }
      function getTmdbId(movie) {
        if (!movie) return '';
        if (movie.tmdb_id) return movie.tmdb_id;
        if (typeof movie.id == 'number' || typeof movie.id == 'string' && /^\d+$/.test(movie.id)) return movie.id;
        return '';
      }
      function getSerial(movie) { if (!movie) return ''; return movie.name ? 1 : 0; }
      function normalizeVoiceName(voice) { return voice.display_name || voice.displayName || voice.name || voice.id || ''; }
      function getSeasonNumber(value, fallback) {
        if (typeof value == 'number') return value;
        var match = String(value || '').match(/(\d+)/);
        if (match) { var parsed = parseInt(match[1], 10); if (!isNaN(parsed)) return parsed; }
        return fallback;
      }
      function createLazyState() { return { enabled: false, season_numbers: [], loaded: {}, pending: {} }; }
      function isSeriesObject() { return !!(object && object.movie && object.movie.name); }
      function isUaflixLazyMode() { return sourceKey == 'uaflix' && isSeriesObject(); }
      function toPositiveInt(value) { var parsed = parseInt(value, 10); return isNaN(parsed) || parsed < 1 ? 0 : parsed; }
      function cloneRef(ref) {
        var next = {};
        if (ref && _typeof(ref) == 'object') Lampa.Arrays.extend(next, ref, true);
        return next;
      }
      function sortSeasonNumbers(values) {
        var map = {};
        (values || []).forEach(function (value) { var number = toPositiveInt(value); if (number) map[number] = true; });
        return Object.keys(map).map(function (value) { return parseInt(value, 10); }).sort(function (a, b) { return a - b; });
      }
      function getRefSeasonNumber(ref) { return toPositiveInt(ref && ref.season); }
      function getTmdbSeasonNumbers() {
        var count = toPositiveInt(object && object.movie && object.movie.number_of_seasons);
        var seasons = [];
        for (var i = 1; i <= count; i++) seasons.push(i);
        return seasons;
      }
      function collectVoiceSeasonNumbers(voice) {
        var seasons = getVoiceSeasons(voice);
        return sortSeasonNumbers(seasons.map(function (season, index) {
          return getSeasonNumber(season.title || season.season || season.number, index + 1);
        }));
      }
      function collectSeriesSeasonNumbers() {
        if (!series || !Array.isArray(series.voices)) return [];
        var seasons = [];
        series.voices.forEach(function (voice) { seasons = seasons.concat(collectVoiceSeasonNumbers(voice)); });
        return sortSeasonNumbers(seasons);
      }
      function ensureLazySeasonNumbers(values) {
        lazy_state.season_numbers = sortSeasonNumbers((lazy_state.season_numbers || []).concat(values || []));
      }
      function markLazySeasonLoaded(values) {
        (values || []).forEach(function (value) { var number = toPositiveInt(value); if (number) lazy_state.loaded[number] = true; });
      }
      function getSeasonNumbersForFilter(voice) {
        if (lazy_state.enabled && lazy_state.season_numbers.length) return lazy_state.season_numbers.slice(0);
        return collectVoiceSeasonNumbers(voice);
      }
      function getSeasonData(voice, season_number) {
        var seasons = getVoiceSeasons(voice);
        for (var i = 0; i < seasons.length; i++) {
          var season = seasons[i];
          var number = getSeasonNumber(season.title || season.season || season.number, i + 1);
          if (number == season_number) return season;
        }
        return null;
      }
      function getSeasonEpisodes(voice, season_number) {
        var season = getSeasonData(voice, season_number);
        if (!season) return [];
        return Array.isArray(season.episodes) ? season.episodes : [];
      }
      function findVoiceWithSeasonEpisodes(season_number) {
        if (!series || !Array.isArray(series.voices)) return -1;
        for (var i = 0; i < series.voices.length; i++) { if (getSeasonEpisodes(series.voices[i], season_number).length) return i; }
        return -1;
      }
      function mergeSeriesSeasonData(next_series) {
        if (!next_series || !Array.isArray(next_series.voices)) return;
        if (!series || !Array.isArray(series.voices)) { series = next_series; return; }
        next_series.voices.forEach(function (next_voice) {
          if (!next_voice) return;
          var voice = series.voices.find(function (item) { return item.id == next_voice.id; });
          if (!voice) { series.voices.push(next_voice); return; }
          if (next_voice.display_name) voice.display_name = next_voice.display_name;
          var by_number = {};
          getVoiceSeasons(voice).forEach(function (season, index) {
            var number = getSeasonNumber(season.title || season.season || season.number, index + 1);
            if (number) by_number[number] = season;
          });
          getVoiceSeasons(next_voice).forEach(function (season, index) {
            var number = getSeasonNumber(season.title || season.season || season.number, index + 1);
            if (number) by_number[number] = season;
          });
          voice.seasons = Object.keys(by_number).map(function (value) { return parseInt(value, 10); })
            .sort(function (a, b) { return a - b; }).map(function (number) { return by_number[number]; });
        });
      }
      function buildInitialLazySeasonNumbers(ref) {
        var seasons = getTmdbSeasonNumbers();
        var ref_season = getRefSeasonNumber(ref);
        if (ref_season) seasons.push(ref_season);
        return sortSeasonNumbers(seasons);
      }
      function initializeLazyState(ref) {
        lazy_state = createLazyState();
        if (!isUaflixLazyMode()) return;
        lazy_state.enabled = true;
        var loaded_seasons = collectSeriesSeasonNumbers();
        var initial_seasons = buildInitialLazySeasonNumbers(ref);
        ensureLazySeasonNumbers(initial_seasons);
        ensureLazySeasonNumbers(loaded_seasons);
        markLazySeasonLoaded(loaded_seasons);
        if (!lazy_state.season_numbers.length) { var fallback = getRefSeasonNumber(ref); if (fallback) ensureLazySeasonNumbers([fallback]); }
      }
      function loadLazySeason(season_number, done, fail) {
        if (!lazy_state.enabled || !season_number || !content_ref) { if (fail) fail(); return; }
        if (lazy_state.loaded[season_number]) { if (done) done(); return; }
        if (lazy_state.pending[season_number]) return;
        lazy_state.pending[season_number] = true;
        component.loading(true);
        var ref = cloneRef(content_ref);
        ref.season = season_number;
        api_client.getContent(sourceKey, ref, function (json) {
          delete lazy_state.pending[season_number];
          if (!json || !json.ok || json.type != 'series') {
            component.loading(false); handleSourceError(json);
            if (fail) fail(extractErrorText(json)); return;
          }
          var next_series = normalizeSeries(json);
          mergeSeriesSeasonData(next_series);
          var loaded_seasons = collectSeriesSeasonNumbers();
          markLazySeasonLoaded(loaded_seasons); markLazySeasonLoaded([season_number]);
          ensureLazySeasonNumbers(loaded_seasons); ensureLazySeasonNumbers([season_number]);
          if (done) done();
        }, function () { delete lazy_state.pending[season_number]; component.loading(false); if (fail) fail(); });
      }
      function normalizeEpisodeTitle(episode, number) {
        return episode.title || episode.name || Lampa.Lang.translate('torrent_serial_episode') + ' ' + number;
      }
      function search(params) {
        params = params || {};
        var movie = object && object.movie || object || {};
        if (!params.title) params.title = movie.title || movie.name || '';
        if (!params.original_title) params.original_title = movie.original_title || movie.original_name || '';
        if (!params.year) params.year = getYear(movie);
        if (!params.imdb_id) params.imdb_id = movie.imdb_id || '';
        if (!params.tmdb_id) params.tmdb_id = getTmdbId(movie);
        if (!params.kinopoisk_id) params.kinopoisk_id = movie.kinopoisk_id || '';
        if (!params.mal_id) params.mal_id = movie.mal_id || '';
        if (typeof params.serial == 'undefined') params.serial = getSerial(movie);
        component.loading(true);
        api_client.search(params || {}, sourceKey, function (json) {
          if (!json || !json.ok) { handleSourceError(json); return; }
          if (json.meta && json.meta.code == 'NO_RESULTS') { component.empty(); return; }
          var items = json.items || [];
          if (!items.length) { component.empty(); return; }
          var aggregated_moonanime = sourceKey == 'moonanime' ? items.find(function (item) {
            return item && item.ref && Array.isArray(item.ref.seasons) && item.ref.seasons.length;
          }) : null;
          if (aggregated_moonanime && !object.clarification) { selected = aggregated_moonanime; loadContent(aggregated_moonanime.ref); return; }
          if (items.length > 1 && !object.clarification) {
            component.similars(items.map(function (item) {
              return {
                id: item.ref && (item.ref.id || item.ref.href || item.ref.url || item.ref.play) || item.title,
                title: item.title || item.name, orig_title: item.title_en || item.original_title,
                year: item.year, imdb_id: item.imdb_id, tmdb_id: item.tmdb_id,
                kinopoisk_id: item.kinopoisk_id, mal_id: item.mal_id, serial: item.serial,
                source: item.source || sourceKey,
                poster: sourceKey == 'uaflix' ? item.poster : '',
                ref: item.ref
              };
            }));
            component.loading(false); return;
          }
          selected = items[0]; loadContent(selected.ref);
        }, function () { component.doesNotAnswer(); });
      }
      function loadContent(ref) {
        var request_ref = cloneRef(ref);
        content_ref = cloneRef(ref);
        if (isUaflixLazyMode()) {
          delete content_ref.season;
          var season_numbers = buildInitialLazySeasonNumbers(ref);
          var ref_season = getRefSeasonNumber(ref);
          var season_number = ref_season;
          if (!season_number) {
            if (choice.season >= season_numbers.length) choice.season = 0;
            season_number = season_numbers[choice.season] || season_numbers[0] || 1;
          } else {
            var index = season_numbers.indexOf(ref_season);
            if (index !== -1) choice.season = index;
          }
          request_ref = cloneRef(content_ref);
          request_ref.season = season_number;
        }
        api_client.getContent(sourceKey, request_ref, function (json) {
          if (!json || !json.ok) { handleSourceError(json); return; }
          if (json.type == 'series') { series = normalizeSeries(json); initializeLazyState(ref); filter(); buildEpisodes(); }
          else { lazy_state = createLazyState(); drawMovie(json); }
        }, function () { component.doesNotAnswer(); });
      }
      function normalizeSeries(json) {
        var voices = Array.isArray(json.voices) ? json.voices : [];
        voices = voices.map(function (voice, index) {
          var seasons = Array.isArray(voice.seasons) ? voice.seasons : [];
          return { id: voice.id || voice.voice_id || index, display_name: normalizeVoiceName(voice) || 'Voice ' + (index + 1), seasons: seasons };
        });
        return { voices: voices };
      }
      function getCurrentVoice() {
        if (!series || !series.voices || !series.voices.length) return null;
        return series.voices[choice.voice] || series.voices[0];
      }
      function getVoiceSeasons(voice) { if (!voice || !Array.isArray(voice.seasons)) return []; return voice.seasons; }
      function filter() {
        filter_items = { season: [], voice: [] };
        if (series && series.voices && series.voices.length) {
          filter_items.voice = series.voices.map(function (voice) { return voice.display_name || voice.id; });
        }
        if (choice.voice >= filter_items.voice.length) choice.voice = 0;
        var voice = getCurrentVoice();
        var season_numbers = getSeasonNumbersForFilter(voice);
        filter_items.season = season_numbers.map(function (season_num) {
          return Lampa.Lang.translate('torrent_serial_season') + ' ' + season_num;
        });
        if (choice.season >= filter_items.season.length) choice.season = 0;
        if (voice) choice.voice_name = voice.display_name || voice.id;
        else if (filter_items.voice[choice.voice]) choice.voice_name = filter_items.voice[choice.voice];
        component.filter(filter_items, choice);
      }
      function buildEpisodes() {
        if (!series || !series.voices || !series.voices.length) { component.loading(false); return component.doesNotAnswer(); }
        var voice = getCurrentVoice();
        if (!voice) { component.loading(false); return component.doesNotAnswer(); }
        var season_numbers = getSeasonNumbersForFilter(voice);
        if (!season_numbers.length) { component.loading(false); return component.doesNotAnswer(); }
        var season_index = choice.season;
        if (season_index >= season_numbers.length) season_index = 0;
        choice.season = season_index;
        var season_num = season_numbers[season_index];
        var cache_key = voice.id + ':' + season_num;
        choice.voice_name = voice.display_name || voice.id;
        if (episodes_cache[cache_key]) { renderEpisodes(episodes_cache[cache_key], season_num, voice); return; }
        var episodes = getSeasonEpisodes(voice, season_num);
        if (!episodes.length && lazy_state.enabled) {
          if (!lazy_state.loaded[season_num]) {
            loadLazySeason(season_num, function () { filter(); buildEpisodes(); }, function () { component.doesNotAnswer(); });
            return;
          }
          var voice_index = findVoiceWithSeasonEpisodes(season_num);
          if (voice_index !== -1 && voice_index !== choice.voice) { choice.voice = voice_index; filter(); buildEpisodes(); return; }
        }
        if (!episodes.length) { component.loading(false); return component.doesNotAnswer(); }
        episodes_cache[cache_key] = episodes;
        renderEpisodes(episodes, season_num, voice);
      }
      function renderEpisodes(episodes, season, voice) {
        var items = episodes.map(function (episode, index) {
          var number = episode.number || episode.episode || index + 1;
          return {
            title: normalizeEpisodeTitle(episode, number), season: season, episode: number, ref: episode.ref,
            info: voice.display_name || voice.id, voice_name: voice.display_name || voice.id, voice_id: voice.id,
            subtitles: mergeSubtitles(episode.subtitles, episode.ref && episode.ref.subtitles)
          };
        });
        component.draw(items, {
          onEnter: function onEnter(item) {
            getStream(item.ref, function (streams) {
              var prepared = prepareStreams(streams);
              var first = prepared.first;
              var qualitys = applyProxyToQualitys(prepared.qualitys);
              var play_url = first ? normalizeStreamUrl(first.url) : '';
              if (!first || !play_url) { component.pushError(Lampa.Lang.translate('online_nolink')); return; }
              Lampa.Player.play({
                url: play_url, timeline: item.timeline, quality: qualitys,
                title: item.title, subtitles: mergeSubtitles(first.subtitles, item.subtitles)
              });
              var playlist = [];
              items.forEach(function (elem) {
                var cell = {
                  url: function url(call) {
                    getStream(elem.ref, function (next_streams) {
                      var prepared_next = prepareStreams(next_streams);
                      var next_first = prepared_next.first;
                      cell.url = next_first ? normalizeStreamUrl(next_first.url) : '';
                      cell.quality = applyProxyToQualitys(prepared_next.qualitys);
                      cell.subtitles = mergeSubtitles(next_first && next_first.subtitles, elem.subtitles);
                      elem.mark(); call();
                    }, function () { cell.url = ''; call(); });
                  },
                  title: elem.title, timeline: elem.timeline, quality: {}, subtitles: elem.subtitles || [], mark: elem.mark
                };
                playlist.push(cell);
              });
              Lampa.Player.playlist(playlist);
            }, function (errorText) { component.pushError(errorText || Lampa.Lang.translate('online_nolink')); });
          }
        });
        component.loading(false);
      }
      function drawMovie(json) {
        var items = buildMovieItems(json);
        component.draw(items, {
          onEnter: function onEnter(movie) {
            getMovieStream(movie, function (prepared) {
              var first = prepared.first;
              var qualitys = applyProxyToQualitys(prepared.qualitys);
              var play_url = first ? normalizeStreamUrl(first.url) : '';
              if (!first || !play_url) { component.pushError(Lampa.Lang.translate('online_nolink')); return; }
              Lampa.Player.play({
                url: play_url, timeline: movie.timeline, quality: qualitys,
                title: movie.player_title || movie.title, subtitles: mergeSubtitles(first.subtitles, movie.subtitles)
              });
              Lampa.Player.playlist([]);
            }, function (errorText) { component.pushError(errorText || Lampa.Lang.translate('online_nolink')); });
          }
        });
        component.loading(false);
      }
      function getMovieTitle() { return object.movie.title || object.movie.name || ''; }
      function getMovieStreamLabel(stream, index) { return stream.title || stream.quality || 'stream-' + (index + 1); }
      function normalizeMovieStreamTitle(stream, index) {
        var label = getMovieStreamLabel(stream, index);
        var title = String(stream && stream.title || '').trim();
        if (title) { var cleaned = title.replace(/^\[[^\]]+\]\s*/, '').trim(); if (cleaned) return cleaned; }
        return label;
      }
      function normalizeMovieStreamQuality(stream) { return stream && stream.quality || ''; }
      function buildMovieItems(json) {
        var streams = Array.isArray(json.streams) ? json.streams : [];
        var movie_title = getMovieTitle();
        var items = streams.map(function (stream, index) {
          if (!stream || !stream.url && !stream.ref) return null;
          var label = getMovieStreamLabel(stream, index);
          var stream_title = normalizeMovieStreamTitle(stream, index);
          var stream_quality = normalizeMovieStreamQuality(stream);
          return {
            title: stream_title, info: '', quality: stream_quality, voice_name: label, file: '',
            stream: stream, streams: streams, player_title: movie_title,
            stream_ref: json.stream_ref || null, subtitles: mergeSubtitles(stream.subtitles, json.subtitles)
          };
        }).filter(Boolean);
        if (items.length) return items;
        var voices = Array.isArray(json.voices) ? json.voices : [];
        var voice_items = voices.map(function (voice, index) {
          if (!voice) return null;
          var label = normalizeVoiceName(voice) || 'Voice ' + (index + 1);
          var voice_stream_ref = voice.stream_ref || voice.ref || null;
          var voice_streams = Array.isArray(voice.streams) ? voice.streams.filter(function (stream) { return stream && (stream.url || stream.ref); }) : [];
          if (!voice_stream_ref && !voice_streams.length) return null;
          return {
            title: label, info: '', quality: '', voice_name: label, file: '', streams: voice_streams,
            player_title: movie_title + (label ? ' / ' + label : ''),
            stream_ref: voice_stream_ref, subtitles: mergeSubtitles(voice.subtitles, json.subtitles)
          };
        }).filter(Boolean);
        if (voice_items.length) return voice_items;
        return [{ title: movie_title, info: '', quality: '', voice_name: '', file: '', streams: streams, player_title: movie_title, stream_ref: json.stream_ref || null, subtitles: normalizeSubtitles(json.subtitles) }];
      }
      function parsePackedStreamUrl(value) {
        var text = (value || '').toString().trim();
        if (!text) return [];
        if (text.indexOf('[') === -1 || text.indexOf(']') === -1) return [];
        var items = [];
        text.split(',').forEach(function (part) {
          var match = part.match(/^\s*\[([^\]]+)\]\s*(.+)\s*$/);
          if (!match) return;
          var quality = (match[1] || '').toString().trim();
          var url = (match[2] || '').toString().trim();
          if (!url) return;
          items.push({ title: quality || 'auto', quality: quality || 'auto', url: url });
        });
        return items;
      }
      function normalizeSubtitles(subtitles) {
        if (!Array.isArray(subtitles)) return [];
        var index = -1;
        return subtitles.map(function (subtitle) {
          if (!subtitle || !subtitle.url) return null;
          index++;
          return {
            index: typeof subtitle.index != 'undefined' ? subtitle.index : index,
            label: subtitle.label || subtitle.lang || subtitle.language || Lampa.Lang.translate('player_subs') + ' ' + (index + 1),
            language: subtitle.language || subtitle.lang || subtitle.label || '', url: subtitle.url
          };
        }).filter(Boolean);
      }
      function mergeSubtitles(primary, fallback) {
        var normalized_primary = normalizeSubtitles(primary);
        if (normalized_primary.length) return normalized_primary;
        return normalizeSubtitles(fallback);
      }
      function prepareStreams(streams) {
        var qualitys = {};
        var first = null;
        if (Array.isArray(streams)) {
          streams.forEach(function (stream, index) {
            var variants = [];
            if (stream && stream.url) { var packed = parsePackedStreamUrl(stream.url); if (packed.length) { variants = packed.map(function (item) { var next = {}; Lampa.Arrays.extend(next, stream, true); next.title = item.title || stream.title || stream.quality; next.quality = item.quality || stream.quality; next.url = item.url; return next; }); } }
            if (!variants.length) variants = [stream];
            variants.forEach(function (variant, variant_index) {
              if (variant && variant.subtitles) variant.subtitles = normalizeSubtitles(variant.subtitles);
              var label = variant.title || variant.quality || 'stream-' + (index + 1) + '-' + (variant_index + 1);
              var url = normalizeStreamUrl(variant && variant.url);
              if (url) qualitys[label] = url;
              if (!first && url) first = Object.assign({}, variant, { url: url });
            });
          });
        }
        return { first: first, qualitys: qualitys };
      }
      function normalizeStreamUrl(url) { if (!url) return url; if (!shouldUseAshdiProxy(url)) return url; return wrapAshdiProxy(url); }
      function applyProxyToQualitys(qualitys) {
        var result = {};
        Object.keys(qualitys || {}).forEach(function (key) { result[key] = normalizeStreamUrl(qualitys[key]); });
        return result;
      }
      function shouldUseAshdiProxy(url) { var player = Lampa.Storage.get('player'); if (player && player !== 'inner') return false; return isAshdiUrl(url); }
      function isAshdiUrl(url) { return /(^|\/\/)([^\/]*\.)?ashdi\.vip(\/|$)/i.test(url || ''); }
      function wrapAshdiProxy(url) { var base = 'https://proxy.m7-club.com/?url='; if (url.indexOf(base) === 0) return url; return base + url; }
      function getStream(ref, success, fail) {
        var cache_key = Lampa.Utils.hash(JSON.stringify(ref));
        if (stream_cache[cache_key]) return success(stream_cache[cache_key]);
        if (!ref) { if (fail) fail(); return; }
        api_client.getStream(sourceKey, ref, function (json) {
          if (!json || !json.ok || !Array.isArray(json.streams)) { handleStreamError(json); if (fail) fail(extractErrorText(json)); return; }
          var stream_subtitles = normalizeSubtitles(json.subtitles);
          var streams = json.streams.map(function (stream) {
            if (!stream || stream.subtitles || !stream_subtitles.length) return stream;
            var next = {}; Lampa.Arrays.extend(next, stream, true); next.subtitles = stream_subtitles; return next;
          });
          stream_cache[cache_key] = streams; success(streams);
        }, function () { if (fail) fail(); });
      }
      function getMovieStream(movie, success, fail) {
        if (movie.stream) {
          if (movie.stream.url) { success(prepareStreams([movie.stream])); return; }
          if (movie.stream.ref) { getStream(movie.stream.ref, function (streams) { success(prepareStreams(streams)); }, function (errorText) { if (fail) fail(errorText); }); return; }
        }
        if (movie.stream_ref) { getStream(movie.stream_ref, function (streams) { success(prepareStreams(streams)); }, function (errorText) { if (fail) fail(errorText); }); return; }
        if (movie.streams && movie.streams.length) {
          var direct = movie.streams.filter(function (stream) { return stream && stream.url; });
          if (direct.length) { success(prepareStreams(direct)); return; }
          var ref = movie.streams[0] && movie.streams[0].ref;
          if (ref) { getStream(ref, function (streams) { success(prepareStreams(streams)); }, function (errorText) { if (fail) fail(errorText); }); return; }
        }
        success({ first: null, qualitys: {} });
      }
    };
  }

  var config = {
    api_base: 'https://bbe.lme.isroot.in/api/v2',
    community_watches_url: 'https://lampame.github.io/main/cw.js',
    community_watches_name: 'CommunityWatches',
    qr_url: 'https://lampame.donatik.me',
    qr_poster: 'https://iili.io/fkdGkSj.png',
    storage_prefixes: {
      cw_autoinstall_done: 'uaflix_cw_autoinstall_done',
      last_balanser: 'uaflix_last_balanser',
      balanser: 'uaflix_balanser',
      watched_last: 'uaflix_watched_last',
      view: 'uaflix_view'
    }
  };

  var QR_URL = config.qr_url;
  var QR_TEXT = "<a href=\"".concat(QR_URL, "\">Посилання</a>");
  var QR_BODY = 'Подяка автору плагіну BanderaOnline добровільна, на розвиток якого витрачено багато часу та сил.';
  var QR_CARD_POSTER = config.qr_poster;
  function openQrModal() {
    var html = $('<div class="uaflixplugin-qr-modal">' +
      '<style id="uaflixplugin-qr-style">' +
      '.uaflixplugin-qr-modal__content{display:flex;flex-direction:row;gap:1.2em;align-items:center;text-align:center}' +
      '.uaflixplugin-qr-modal__info{max-width:28em}' +
      '.uaflixplugin-qr-modal__qr{display:flex;flex-direction:column;align-items:center}' +
      '@media (max-width: 600px){.uaflixplugin-qr-modal__content{flex-direction:column}}' +
      '</style>' +
      '<div class="uaflixplugin-qr-modal__content">' +
      '<div class="account-modal-split__info uaflixplugin-qr-modal__info">' +
      "<div class=\"account-modal-split__text\"><img src=\"".concat(QR_CARD_POSTER, "\" class=\"uaflixplugin-qr-modal__img\"><br />").concat(QR_BODY, "</div>") +
      '</div>' +
      '<div class="account-modal-split__qr uaflixplugin-qr-modal__qr">' +
      '<div class="account-modal-split__qr-code" style="margin-bottom:0;width: 13em;height: 13em;"></div>' +
      "<div class=\"account-modal-split__qr-text\">".concat(QR_TEXT, "</div>") +
      '</div></div></div>');
    if ($('#uaflixplugin-qr-style').length) html.find('#uaflixplugin-qr-style').remove();
    var qrElement = html.find('.account-modal-split__qr-code');
    var renderQr = function renderQr() {
      if (!window.qrcode) { qrElement.text('QR недоступний'); return; }
      Lampa.Utils.qrcode(QR_URL, qrElement, function (error) {
        if (error) console.error(error);
        var svg = qrElement.find('svg');
        if (svg[0]) { svg[0].style.setProperty('width', '12em', 'important'); svg[0].style.setProperty('height', '12em', 'important'); }
      });
    };
    if (!window.qrcode && Lampa.Utils.putScript) {
      var qrLib = window.location.protocol == 'file:' ? Lampa.Manifest.github_lampa + 'vender/qrcode/qrcode.js' : './vender/qrcode/qrcode.js';
      Lampa.Utils.putScript([qrLib], renderQr, renderQr, null, false);
    } else renderQr();
    var enabledController = Lampa.Controller.enabled().name;
    Lampa.Modal.open({ title: '', html: html, size: 'medium', onBack: function onBack() { Lampa.Modal.close(); Lampa.Controller.toggle(enabledController); } });
  }

  var AUTH_KEYS$1 = { filmixToken: 'UAFLIX_FILMIX_TOKEN', filmixDeviceId: 'UAFLIX_FILMIX_DEVICE_ID' };
  function normalize(value) { return (value || '').toString().trim(); }
  function read(key) { return normalize(Lampa.Storage.get(key, '')); }
  function write(key, value) { Lampa.Storage.set(key, normalize(value)); }
  function getAuthKeys() { return AUTH_KEYS$1; }
  function getFilmixToken() { return read(AUTH_KEYS$1.filmixToken); }
  function setFilmixToken(value) { write(AUTH_KEYS$1.filmixToken, value); }
  function getFilmixDeviceId() { return read(AUTH_KEYS$1.filmixDeviceId); }
  function setFilmixDeviceId(value) { write(AUTH_KEYS$1.filmixDeviceId, value); }
  function ensureFilmixDeviceId() {
    var deviceId = getFilmixDeviceId();
    if (!deviceId) { deviceId = Lampa.Utils.uid(16); setFilmixDeviceId(deviceId); }
    return deviceId;
  }

  var APIClient = function () {
    function APIClient() { _classCallCheck(this, APIClient); this.network = new Lampa.Reguest(); }
    return _createClass(APIClient, [
      { key: "apiBase", value: function apiBase() { return config.api_base; } },
      { key: "getAuth", value: function getAuth() {
          var token = getFilmixToken(); var deviceId = getFilmixDeviceId();
          if (token && !deviceId) deviceId = ensureFilmixDeviceId();
          return { filmix_token: token, filmix_device_id: deviceId };
        }
      },
      { key: "addParam", value: function addParam(url, key, value) { if (!value) return url; return Lampa.Utils.addUrlComponent(url, key + '=' + encodeURIComponent(value)); } },
      { key: "postJson", value: function postJson(url, data, success, fail) { this.network.silent(url, success, fail, JSON.stringify(data), { dataType: 'json', headers: { 'Content-Type': 'application/json' } }); } },
      { key: "getJson", value: function getJson(url, success, fail) { this.network.silent(url, success, fail); } },
      { key: "clear", value: function clear() { this.network.clear(); } },
      { key: "getSources", value: function getSources(success, fail) { this.getJson(this.apiBase() + '/sources', success, fail); } },
      { key: "search", value: function search(params, sources, success, fail) {
          var url = this.apiBase() + '/search';
          var sourceKey = Array.isArray(sources) ? sources.join(',') : sources;
          url = this.addParam(url, 'sources', sourceKey); url = this.addParam(url, 'source', sourceKey);
          for (var key in params) url = this.addParam(url, key, params[key]);
          var auth = this.getAuth();
          if (sources === 'filmix' || Array.isArray(sources) && sources.indexOf('filmix') !== -1) {
            url = this.addParam(url, 'filmix_token', auth.filmix_token);
            url = this.addParam(url, 'filmix_device_id', auth.filmix_device_id);
          }
          this.getJson(url, success, fail);
        }
      },
      { key: "getContent", value: function getContent(sourceKey, ref, success, fail) {
          var url = this.apiBase() + '/content';
          var data = { source: sourceKey, ref: this.extendRefWithAuth(sourceKey, ref), full: true };
          this.postJson(url, data, success, fail);
        }
      },
      { key: "getStream", value: function getStream(sourceKey, ref, success, fail) {
          var url = this.apiBase() + '/stream';
          var data = { source: sourceKey, ref: this.extendRefWithAuth(sourceKey, ref) };
          this.postJson(url, data, success, fail);
        }
      },
      { key: "extendRefWithAuth", value: function extendRefWithAuth(sourceKey, ref) {
          if (!ref || _typeof(ref) !== 'object') return ref;
          var auth = this.getAuth(); var next = {};
          Lampa.Arrays.extend(next, ref, true);
          if (sourceKey == 'filmix') {
            if (!next.token && auth.filmix_token) next.token = auth.filmix_token;
            if (!next.device_id && auth.filmix_device_id) next.device_id = auth.filmix_device_id;
          }
          return next;
        }
      }
    ]);
  }();

  var SourcesStore = function () {
    function SourcesStore() {
      _classCallCheck(this, SourcesStore);
      this.sources_key = 'UAFLIX_SOURCES';
      this.sources_sort_key = 'UAFLIX_SOURCES_SORT';
      this.sources_hide_key = 'UAFLIX_SOURCES_HIDE';
      this.available_sources = Lampa.Storage.get(this.sources_key, []);
      this.titles = {};
      this.applyTitles(this.available_sources);
    }
    return _createClass(SourcesStore, [
      { key: "normalizeName", value: function normalizeName(name) { return (name || '').toString().trim().toLowerCase(); } },
      { key: "applyTitles", value: function applyTitles(list) {
          var _this = this;
          if (!Array.isArray(list)) return;
          list.forEach(function (item) {
            if (!item) return;
            var key = _this.normalizeName(item.key || item.name);
            var title = item.display_name || item.displayName || item.display || item.title || item.label || item.name || '';
            if (key && title) _this.titles[key] = title;
          });
        }
      },
      { key: "getSorted", value: function getSorted() { var sorted = Lampa.Storage.get(this.sources_sort_key, []); return Array.isArray(sorted) ? sorted.map(this.normalizeName).filter(Boolean) : []; } },
      { key: "getHidden", value: function getHidden() { var hidden = Lampa.Storage.get(this.sources_hide_key, []); return Array.isArray(hidden) ? hidden.map(this.normalizeName).filter(Boolean) : []; } },
      { key: "saveAvailable", value: function saveAvailable(list) { this.available_sources = list; this.applyTitles(list); Lampa.Storage.set(this.sources_key, list); } },
      { key: "saveSorted", value: function saveSorted(list) { Lampa.Storage.set(this.sources_sort_key, list); } },
      { key: "saveHidden", value: function saveHidden(list) { Lampa.Storage.set(this.sources_hide_key, list); } },
      { key: "getEnabledKeys", value: function getEnabledKeys() {
          var _this2 = this;
          return this.available_sources.filter(function (item) { return item && item.enabled !== false; })
            .map(function (item) { return _this2.normalizeName(item.key || item.name); }).filter(Boolean);
        }
      },
      { key: "applyUserFilters", value: function applyUserFilters(list) {
          var hidden = this.getHidden(); var sorted = this.getSorted(); var result = list.slice(0);
          if (sorted.length) {
            var ordered = [];
            sorted.forEach(function (key) { if (result.indexOf(key) !== -1) ordered.push(key); });
            result.forEach(function (key) { if (ordered.indexOf(key) === -1) ordered.push(key); });
            result = ordered;
          }
          if (hidden.length) result = result.filter(function (name) { return hidden.indexOf(name) === -1; });
          return result;
        }
      },
      { key: "getTitle", value: function getTitle(key) { return this.titles[this.normalizeName(key)] || key; } }
    ]);
  }();
  var sourcesStore = new SourcesStore();

  function getFileId(movie) {
    if (!movie) return '';
    var title = movie.number_of_seasons ? movie.original_name || movie.name || movie.title : movie.original_title || movie.title || movie.name;
    var id = movie.tmdb_id || movie.id;
    var key = title || (id ? 'id:' + id : '') || '';
    return Lampa.Utils.hash(key);
  }
  function getHashTimeline(movie, season, episode) {
    var title = movie.original_title || movie.original_name || movie.name || movie.title || '';
    return Lampa.Utils.hash(season ? [season, episode, title].join('') : title);
  }
  function getHashBehold(movie, season, episode, voice_name) {
    var title = movie.original_title || movie.original_name || movie.name || movie.title || '';
    var vn = voice_name || '';
    return Lampa.Utils.hash(season ? [season, episode, title, vn].join('') : title + vn);
  }

  function component(object) {
    var api_client = new APIClient();
    this.api_client = api_client;
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var sources = {};
    function ensureSource(key) { if (key && !sources[key]) sources[key] = createV2(key); return sources[key]; }
    var last, extended, selected_id, source, balanser, initialized, balanser_timer;
    var images = [];
    var disabled_sources = {};
    var filter_sources = buildFilterSources(object && object.movie);
    var available_sources = sourcesStore.available_sources;
    var tmdb_season_cache = {};

    function escapeHtml(t) {
      if (!t) return '';
      return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }
    var filter_translate = {
      season: Lampa.Lang.translate('torrent_serial_season'),
      voice: Lampa.Lang.translate('torrent_parser_voice'),
      source: Lampa.Lang.translate('settings_rest_source')
    };
    function isSourceDisabled(name) { return !!disabled_sources[name]; }
    function buildSourceSortItems() {
      return filter_sources.map(function(key) {
        var d = isSourceDisabled(key);
        return { title: sourcesStore.getTitle(key), source: key, selected: key == balanser, ghost: d, noenter: d };
      });
    }
    function updateSourceSort() { if (!filter) return; filter.set('sort', buildSourceSortItems()); filter.chosen('sort', [sourcesStore.getTitle(balanser)]); }
    function resolveEpisodeNumber(v, fb) { if (v === null || typeof v === 'undefined' || v === '') return fb; return v; }
    function formatEpisodeNumber(v, fb) {
      var ep = resolveEpisodeNumber(v, typeof fb === 'undefined' ? 0 : fb);
      var t = (ep + '').trim(); if (!t) t = '0';
      return t.length < 2 ? '0' + t : t;
    }
    function buildFilterSources(movie) {
      var s = getBaseSources();
      var inc_anime = shouldIncludeAnimeSources(movie);
      if (inc_anime) {
        ['bambooua','animeon','moonanime','mikai'].forEach(function(n){ if (s.indexOf(n)===-1) s.push(n); });
      } else { s = s.filter(function(n){ return n!=='bambooua'&&n!=='animeon'&&n!=='moonanime'&&n!=='mikai'; }); }
      if (shouldIncludeStarlightSource(movie)) { if (s.indexOf('starlight')===-1) s.push('starlight'); }
      else s = s.filter(function(n){ return n!=='starlight'; });
      if (shouldIncludeMidnightSource(movie)) { if (s.indexOf('midnight')===-1) s.push('midnight'); }
      else s = s.filter(function(n){ return n!=='midnight'; });
      s = filterEnabledSources(s);
      s = sourcesStore.applyUserFilters(s);
      return s;
    }
    function getBaseSources() { var fa = getEnabledSources(); if (fa) return fa; var k = Object.keys(sources); return k.length ? k : []; }
    function filterEnabledSources(list) { var e = getEnabledSources(); if (!e) return list; return list.filter(function(n){ return e.indexOf(n)!==-1; }); }
    function getEnabledSources() {
      if (!available_sources || !available_sources.length) return null;
      var e = available_sources.filter(function(i){ return i && i.enabled!==false; })
        .map(function(i){ return sourcesStore.normalizeName(i.key||i.name); }).filter(Boolean);
      e.forEach(function(n){ return ensureSource(n); });
      return e.length ? e : null;
    }
    function loadAvailableSources(call) {
      var cached = Lampa.Storage.get(sourcesStore.sources_key, null);
      api_client.getSources(function(json) {
        if (json && json.ok && Array.isArray(json.sources)) { applyAvailableSources(json.sources); sourcesStore.saveAvailable(json.sources); }
        else if (cached && Array.isArray(cached)) applyAvailableSources(cached);
        call();
      }, function() { if (cached && Array.isArray(cached)) applyAvailableSources(cached); call(); });
    }
    function applyAvailableSources(list) {
      available_sources = list;
      list.forEach(function(item) {
        if (!item || !item.name && !item.key) return;
        var d = item.display_name||item.displayName||item.display||item.title||item.label||item.name||'';
        var key = sourcesStore.normalizeName(item.key||item.name);
        if (key) { ensureSource(key); if (d) sourcesStore.titles[key] = d; }
      });
    }
    function shouldIncludeAnimeSources(movie) {
      if (!movie) return true;
      var lang = movie.original_language;
      var is_anime_lang = lang=='ja'||lang=='zh'; var is_dorama = lang=='ko';
      var has_genre = Array.isArray(movie.genres) && movie.genres.some(function(g){ return g&&g.id==16; });
      var title = movie.original_title||movie.original_name||movie.title||movie.name||'';
      var has_jp = Lampa.Utils.containsJapanese ? Lampa.Utils.containsJapanese(title) : false;
      var is_anime = is_anime_lang&&(has_genre||has_jp)||has_jp;
      return !lang||is_anime||is_dorama;
    }
    function shouldIncludeStarlightSource(movie) { return movie && (movie.original_language||'').toLowerCase()==='uk'; }
    function shouldIncludeMidnightSource(movie) { return movie && (movie.original_language||'').toLowerCase()==='uk'; }
    function getYear(movie) { var d=movie.release_date||movie.first_air_date||movie.year||movie.start_date; return d?(d+'').slice(0,4):''; }
    function getTmdbId(movie) {
      if (!movie) return '';
      if (movie.tmdb_id) return movie.tmdb_id;
      if (typeof movie.id=='number'||typeof movie.id=='string'&&/^\d+$/.test(movie.id)) return movie.id;
      return '';
    }

    this.initialize = function() {
      var _this = this;
      loadAvailableSources(function() {
        filter_sources = buildFilterSources(object && object.movie);
        source = _this.createSource();
        filter.onSearch = function(v) { Lampa.Activity.replace({ search: v, clarification: true }); };
        filter.onBack = function() { _this.start(); };
        filter.render().find('.selector').on('hover:enter', function() { clearInterval(balanser_timer); });
        filter.onSelect = function(type, a, b) {
          if (type=='filter') {
            if (a.reset) { if (extended) source.reset(); else _this.start(); }
            else if (a.stype=='source') { Lampa.Select.close(); _this.changeBalanser(b.source); }
            else source.filter(type, a, b);
          } else if (type=='sort') { Lampa.Select.close(); _this.changeBalanser(a.source); }
        };
        if (filter.addButtonBack) filter.addButtonBack();
        filter.render().find('.filter--sort span').text(Lampa.Lang.translate('online_balanser'));
        var donateButton = $('<div class="simple-button simple-button--filter selector filter--donate"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M17.726 13.02 14 16H9v-1h4.065a.5.5 0 0 0 .416-.777l-.888-1.332A1.995 1.995 0 0 0 10.93 12H3a1 1 0 0 0-1 1v6a2 2 0 0 0 2 2h9.639a3 3 0 0 0 2.258-1.024L22 13l-1.452-.484a2.998 2.998 0 0 0-2.822.504zm1.532-5.63c.451-.465.73-1.108.73-1.818s-.279-1.353-.73-1.818A2.447 2.447 0 0 0 17.494 3S16.25 2.997 15 4.286C13.75 2.997 12.506 3 12.506 3a2.45 2.45 0 0 0-1.764.753c-.451.466-.730 1.108-.730 1.818s.279 1.354.73 1.818L15 12l4.258-4.61z"/></svg><span>Подяка</span><div class="hide"></div></div>');
        filter.render().find('.filter--filter').after(donateButton);
        donateButton.on('hover:enter', function() { openQrModal(); });
        files.appendFiles(scroll.render());
        files.appendHead(filter.render());
        scroll.body().addClass('torrent-list');
        scroll.minus(files.render().find('.explorer__files-head'));
        _this.search();
      });
    };
    this.changeBalanser = function(balanser_name) {
      if (isSourceDisabled(balanser_name)) return;
      var lb = Lampa.Storage.cache('uaflix_last_balanser', 3000, {});
      lb[object.movie.id] = balanser_name;
      Lampa.Storage.set('uaflix_last_balanser', lb);
      Lampa.Storage.set('uaflix_balanser', balanser_name);
      var to = this.getChoice(balanser_name); var from = this.getChoice();
      if (from.voice_name) to.voice_name = from.voice_name;
      this.saveChoice(to, balanser_name); this.reset();
      source = this.createSource(); this.search();
    };
    this.createSource = function() {
      var lb = Lampa.Storage.cache('uaflix_last_balanser', 3000, {});
      if (lb[object.movie.id]) { balanser = lb[object.movie.id]; Lampa.Storage.set('uaflix_last_balanser', lb); }
      else balanser = Lampa.Storage.get('uaflix_balanser', 'uatut');
      if (!ensureSource(balanser) || filter_sources.indexOf(balanser)===-1) balanser = filter_sources[0] || '';
      if (!ensureSource(balanser)) return null;
      return new sources[balanser](this, object);
    };
    this.proxy = function(name) {
      var prox = Lampa.Storage.get('uaflix_proxy_all');
      var need = Lampa.Storage.get('uaflix_proxy_' + name);
      if (need) prox = need;
      if (prox && prox.slice(-1)!=='/') prox += '/';
      return prox;
    };
    this.create = function() { return this.render(); };
    this.search = function() { this.activity.loader(true); this.filter({ source: filter_sources }, this.getChoice()); this.find(); };
    this.find = function() {
      if (object.movie.imdb_id && source.searchByImdbID) { this.extendChoice(); source.searchByImdbID(object, object.movie.imdb_id); return; }
      if (object.movie.kinopoisk_id && source.searchByKinopoisk) { this.extendChoice(); source.searchByKinopoisk(object, object.movie.kinopoisk_id); return; }
      if (object.movie.mal_id && source.searchByMalId) { this.extendChoice(); source.searchByMalId(object, object.movie.mal_id); return; }
      if (source.searchByTitle) { this.extendChoice(); source.searchByTitle(object, object.movie.title||object.movie.name); return; }
      if (source.search) { this.extendChoice(); source.search(object, [{ title: object.movie.title||object.movie.name, original_title: object.movie.original_title||object.movie.original_name, imdb_id: object.movie.imdb_id, tmdb_id: getTmdbId(object.movie), kinopoisk_id: object.movie.kinopoisk_id, mal_id: object.movie.mal_id, year: getYear(object.movie) }]); return; }
      this.doesNotAnswer();
    };
    this.getChoice = function(for_balanser) {
      var data = Lampa.Storage.cache('uaflix_choice_' + (for_balanser||balanser), 3000, {});
      var save = data[selected_id||object.movie.id] || {};
      Lampa.Arrays.extend(save, { season: 0, voice: 0, voice_name: '', voice_id: 0, episodes_view: {}, movie_view: '' });
      return save;
    };
    this.extendChoice = function() { extended = true; source.extendChoice(this.getChoice()); };
    this.saveChoice = function(choice, for_balanser) {
      var data = Lampa.Storage.cache('uaflix_choice_' + (for_balanser||balanser), 3000, {});
      data[selected_id||object.movie.id] = choice;
      Lampa.Storage.set('uaflix_choice_' + (for_balanser||balanser), data);
    };
    this.similars = function(json) {
      var _this2 = this;
      json.forEach(function(elem) {
        var info = []; var year = ((elem.year||elem.start_date||'')+'').slice(0,4);
        if (year) info.push(year);
        if (elem.season) info.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + elem.season);
        var name = elem.title||elem.name||''; var orig = elem.title_en||elem.original_title||elem.orig_title||'';
        elem.title = escapeHtml(name + (orig&&orig!==name?' / '+orig:''));
        elem.time = elem.time||'';
        elem.info = info.join('<span class="online-prestige-split">●</span>');
        var item = Lampa.Template.get('uaflix_plugin_folder', elem);
        if (elem.poster && (elem.source=='uaflix'||balanser=='uaflix')) {
          var folder = item.find('.online-prestige__folder');
          var poster = $('<div class="online-prestige__img online-prestige__img--loaded"><img alt="" src="' + escapeHtml(elem.poster) + '"></div>');
          var img = poster.find('img')[0];
          img.onerror = function() { poster.replaceWith(folder); };
          folder.replaceWith(poster);
        }
        item.on('hover:enter', function() {
          _this2.activity.loader(true); _this2.reset();
          object.search_date = year; selected_id = elem.id; _this2.extendChoice();
          var kp_id = elem.kp_id||elem.filmId; var mal_id = elem.mal_id||elem.malId;
          var has_ref = elem.ref && Array.isArray(elem.ref.seasons) && elem.ref.seasons.length;
          if (has_ref && source.search) source.search(object, [elem]);
          else if (kp_id && source.searchByKinopoisk) source.searchByKinopoisk(object, kp_id);
          else if (mal_id && source.searchByMalId) source.searchByMalId(object, mal_id);
          else if (source.search) source.search(object, [elem]);
          else _this2.doesNotAnswer();
        }).on('hover:focus', function(e) { last = e.target; scroll.update($(e.target), true); });
        scroll.append(item);
      });
    };
    this.clearImages = function() { images.forEach(function(img){ img.onerror=function(){}; img.onload=function(){}; img.src=''; }); images=[]; };
    this.reset = function() { last=false; clearInterval(balanser_timer); api_client.clear(); this.clearImages(); scroll.render().find('.empty').remove(); scroll.clear(); };
    this.loading = function(status) { if (status) this.activity.loader(true); else { this.activity.loader(false); this.activity.toggle(); } };
    this.filter = function(filter_items, choice) {
      var _this3 = this; var select = [];
      var add = function(type, title) {
        var need = _this3.getChoice(); var items = filter_items[type]; var subitems = []; var value = need[type];
        items.forEach(function(name,i){ subitems.push({ title:name, selected:value==i, index:i }); });
        select.push({ title:title, subtitle:items[value], items:subitems, stype:type });
      };
      filter_items.source = filter_sources;
      select.push({ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true });
      if (filter_sources && filter_sources.length) {
        var si = [];
        filter_sources.forEach(function(name,i){ si.push({ title:sourcesStore.getTitle(name), selected:name==balanser, index:i, source:name }); });
        select.push({ title:Lampa.Lang.translate('online_balanser'), subtitle:sourcesStore.getTitle(balanser), items:si, stype:'source' });
      }
      this.saveChoice(choice);
      if (filter_items.voice && filter_items.voice.length) add('voice', Lampa.Lang.translate('torrent_parser_voice'));
      if (filter_items.season && filter_items.season.length) add('season', Lampa.Lang.translate('torrent_serial_season'));
      filter.set('filter', select); filter.set('sort', buildSourceSortItems()); this.selected(filter_items);
    };
    this.disableSource = function(source_name, reason) {
      var key = sourcesStore.normalizeName(source_name); if (!key) return;
      if (!disabled_sources[key]) { disabled_sources[key] = { reason: reason||'' }; updateSourceSort(); }
    };
    this.pushError = function(text) { if (text) Lampa.Bell.push({ text: text }); };
    this.closeFilter = function() { if ($('body').hasClass('selectbox--open')) Lampa.Select.close(); };
    this.selected = function(filter_items) {
      var need = this.getChoice(), select = [];
      for (var i in need) {
        if (filter_items[i] && filter_items[i].length) {
          if (i=='voice') select.push(filter_translate[i]+': '+filter_items[i][need[i]]);
          else if (i!=='source') { if (filter_items.season.length>=1) select.push(filter_translate.season+': '+filter_items[i][need[i]]); }
        }
      }
      filter.chosen('filter', select); filter.chosen('sort', [sourcesStore.getTitle(balanser)]);
    };
    this.getEpisodes = function(season, call) {
      var id = getTmdbId(object.movie); var ck = id+'_'+season;
      if (tmdb_season_cache[ck]) return call(tmdb_season_cache[ck]);
      if (id && object.movie.name) {
        Lampa.Api.sources.tmdb.get('tv/'+id+'/season/'+season, {}, function(data){ tmdb_season_cache[ck]=data.episodes||[]; call(tmdb_season_cache[ck]); }, function(){ call([]); });
      } else call([]);
    };
    this.append = function(item) { item.on('hover:focus', function(e){ last=e.target; scroll.update($(e.target),true); }); scroll.append(item); };
    this.watched = function(set) {
      var file_id = getFileId(object.movie);
      var watched = Lampa.Storage.cache('online_watched_last', 5000, {});
      if (set) {
        if (!watched[file_id]) watched[file_id]={};
        Lampa.Arrays.extend(watched[file_id], set, true);
        Lampa.Storage.set('online_watched_last', watched); this.updateWatched();
      } else return watched[file_id];
    };
    this.updateWatched = function() {
      var watched = this.watched();
      var body = scroll.body().find('.online-prestige-watched .online-prestige-watched__body').empty();
      if (watched) {
        var line = [];
        if (watched.balanser_name) line.push(watched.balanser_name);
        if (watched.voice_name) line.push(watched.voice_name);
        if (watched.season) line.push(Lampa.Lang.translate('torrent_serial_season')+' '+watched.season);
        if (watched.episode) line.push(Lampa.Lang.translate('torrent_serial_episode')+' '+watched.episode);
        line.forEach(function(n){ body.append('<span>'+n+'</span>'); });
      } else body.append('<span>'+Lampa.Lang.translate('online_no_watch_history')+'</span>');
    };
    this.draw = function(items) {
      var _this4 = this;
      var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      if (!items.length) return this.empty();
      scroll.append(Lampa.Template.get('uaflix_plugin_watched', {}));
      this.updateWatched();
      this.getEpisodes(items[0].season, function(episodes) {
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        var serial = object.movie.name ? true : false;
        var choice = _this4.getChoice();
        var fully = window.innerWidth > 480;
        var scroll_to_element = false; var scroll_to_mark = false;
        items.forEach(function(element, index) {
          var episode = serial&&episodes.length&&!params.similars ? episodes.find(function(e){ return e.episode_number==element.episode; }) : false;
          var episode_num = resolveEpisodeNumber(element.episode, index+1);
          var episode_last = choice.episodes_view[element.season];
          Lampa.Arrays.extend(element, { info:'', quality:'', time:Lampa.Utils.secondsToTime((episode?episode.runtime:object.movie.runtime)*60,true) });
          var hash_timeline = getHashTimeline(object.movie, element.season, element.episode);
          var hash_behold = getHashBehold(object.movie, element.season, element.episode, element.voice_name);
          var data = { hash_timeline:hash_timeline, hash_behold:hash_behold };
          var info = [];
          if (element.season) { element.translate_episode_end=_this4.getLastEpisode(items); element.translate_voice=element.voice_name; }
          element.timeline = Lampa.Timeline.view(hash_timeline);
          if (episode) {
            element.title = escapeHtml(episode.name);
            if (element.info.length<30 && episode.vote_average) info.push(Lampa.Template.get('uaflix_plugin_rate',{rate:parseFloat(episode.vote_average+'').toFixed(1)},true));
            if (episode.air_date&&fully) info.push(Lampa.Utils.parseTime(episode.air_date).full);
          } else if (object.movie.release_date&&fully) info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
          if (!serial&&object.movie.tagline&&element.info.length<30) info.push(escapeHtml(object.movie.tagline));
          if (element.info) info.push(element.info);
          if (info.length) element.info = info.map(function(i){ return '<span>'+i+'</span>'; }).join('<span class="online-prestige-split">●</span>');
          var html = Lampa.Template.get('uaflix_plugin_full', element);
          var loader = html.find('.online-prestige__loader');
          var image = html.find('.online-prestige__img');
          if (!serial) { if (choice.movie_view==hash_behold) scroll_to_element=html; }
          else if (typeof episode_last!=='undefined'&&episode_last==episode_num) scroll_to_element=html;
          if (serial&&!episode) { image.append('<div class="online-prestige__episode-number">'+formatEpisodeNumber(element.episode,index+1)+'</div>'); loader.remove(); }
          else {
            var img = html.find('img')[0];
            img.onerror=function(){ img.src='./img/img_broken.svg'; };
            img.onload=function(){ image.addClass('online-prestige__img--loaded'); loader.remove(); if (serial) image.append('<div class="online-prestige__episode-number">'+formatEpisodeNumber(element.episode,index+1)+'</div>'); };
            var path = episode?episode.still_path:object.movie.backdrop_path;
            if (path) img.src=Lampa.TMDB.image('t/p/w300'+path); else img.src='./img/img_broken.svg';
            images.push(img);
          }
          html.find('.online-prestige__timeline').append(Lampa.Timeline.render(element.timeline));
          if (viewed.indexOf(hash_behold)!==-1) { scroll_to_mark=html; html.find('.online-prestige__img').append('<div class="online-prestige__viewed">'+Lampa.Template.get('icon_viewed',{},true)+'</div>'); }
          element.mark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold)===-1) {
              viewed.push(hash_behold); Lampa.Storage.set('online_view', viewed);
              if (html.find('.online-prestige__viewed').length===0) html.find('.online-prestige__img').append('<div class="online-prestige__viewed">'+Lampa.Template.get('icon_viewed',{},true)+'</div>');
            }
            choice = _this4.getChoice();
            if (!serial) choice.movie_view=hash_behold; else choice.episodes_view[element.season]=episode_num;
            _this4.saveChoice(choice);
            _this4.watched({ balanser:balanser, balanser_name:sourcesStore.getTitle(balanser), voice_id:choice.voice_id, voice_name:choice.voice_name||element.voice_name, episode:element.episode, season:element.season });
          };
          element.unmark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold)!==-1) {
              Lampa.Arrays.remove(viewed, hash_behold); Lampa.Storage.set('online_view', viewed);
              if (Lampa.Manifest.app_digital>=177) Lampa.Storage.remove('online_view', hash_behold);
              html.find('.online-prestige__viewed').remove();
            }
          };
          element.timeclear = function() { element.timeline.percent=0; element.timeline.time=0; element.timeline.duration=0; Lampa.Timeline.update(element.timeline); };
          html.on('hover:enter', function() {
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            if (params.onEnter) params.onEnter(element, html, data);
          }).on('hover:focus', function(e) {
            last=e.target; if (params.onFocus) params.onFocus(element,html,data); scroll.update($(e.target),true);
          });
          if (params.onRender) params.onRender(element, html, data);
          _this4.contextMenu({ html:html, element:element,
            onFile:function(call){ if (params.onContextMenu) params.onContextMenu(element,html,data,call); },
            onClearAllMark:function(){ items.forEach(function(e){ e.unmark(); }); },
            onClearAllTime:function(){ items.forEach(function(e){ e.timeclear(); }); }
          });
          scroll.append(html);
        });
        if (serial&&episodes.length>items.length&&!params.similars) {
          episodes.slice(items.length).forEach(function(episode) {
            var info=[];
            if (episode.vote_average) info.push(Lampa.Template.get('uaflix_plugin_rate',{rate:parseFloat(episode.vote_average+'').toFixed(1)},true));
            if (episode.air_date) info.push(Lampa.Utils.parseTime(episode.air_date).full);
            var air=new Date((episode.air_date+'').replace(/-/g,'/')); var now=Date.now();
            var day=Math.round((air.getTime()-now)/(24*60*60*1000));
            var txt=Lampa.Lang.translate('full_episode_days_left')+': '+day;
            var html=Lampa.Template.get('uaflix_plugin_full',{
              time:Lampa.Utils.secondsToTime((episode?episode.runtime:object.movie.runtime)*60,true),
              info:info.length?info.map(function(i){ return '<span>'+i+'</span>'; }).join('<span class="online-prestige-split">●</span>'):'',
              title:escapeHtml(episode.name), quality:day>0?txt:''
            });
            var loader=html.find('.online-prestige__loader'); var image=html.find('.online-prestige__img');
            var season=items[0]?items[0].season:1;
            html.find('.online-prestige__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(getHashTimeline(object.movie,season,episode.episode_number))));
            var img=html.find('img')[0];
            if (episode.still_path) {
              img.onerror=function(){ img.src='./img/img_broken.svg'; };
              img.onload=function(){ image.addClass('online-prestige__img--loaded'); loader.remove(); image.append('<div class="online-prestige__episode-number">'+formatEpisodeNumber(episode.episode_number)+'</div>'); };
              img.src=Lampa.TMDB.image('t/p/w300'+episode.still_path); images.push(img);
            } else { img.src='./img/img_broken.svg'; loader.remove(); image.append('<div class="online-prestige__episode-number">'+formatEpisodeNumber(episode.episode_number)+'</div>'); }
            html.on('hover:focus', function(e){ last=e.target; scroll.update($(e.target),true); });
            scroll.append(html);
          });
        }
        if (scroll_to_element) last=scroll_to_element[0]; else if (scroll_to_mark) last=scroll_to_mark[0];
        Lampa.Controller.enable('content');
      });
    };
    this.contextMenu = function(params) {
      params.html.on('hover:long', function() {
        function show(extra) {
          var enabled=Lampa.Controller.enabled().name; var menu=[];
          if (Lampa.Platform.is('webos')) menu.push({ title:Lampa.Lang.translate('player_lauch')+' - Webos', player:'webos' });
          if (Lampa.Platform.is('android')) menu.push({ title:Lampa.Lang.translate('player_lauch')+' - Android', player:'android' });
          menu.push({ title:Lampa.Lang.translate('player_lauch')+' - Lampa', player:'lampa' });
          menu.push({ title:Lampa.Lang.translate('online_video'), separator:true });
          menu.push({ title:Lampa.Lang.translate('torrent_parser_label_title'), mark:true });
          menu.push({ title:Lampa.Lang.translate('torrent_parser_label_cancel_title'), unmark:true });
          menu.push({ title:Lampa.Lang.translate('time_reset'), timeclear:true });
          if (extra) menu.push({ title:Lampa.Lang.translate('copy_link'), copylink:true });
          menu.push({ title:Lampa.Lang.translate('more'), separator:true });
          if (Lampa.Account.logged()&&params.element&&typeof params.element.season!=='undefined'&&params.element.translate_voice)
            menu.push({ title:Lampa.Lang.translate('online_voice_subscribe'), subscribe:true });
          menu.push({ title:Lampa.Lang.translate('online_clear_all_marks'), clearallmark:true });
          menu.push({ title:Lampa.Lang.translate('online_clear_all_timecodes'), timeclearall:true });
          Lampa.Select.show({ title:Lampa.Lang.translate('title_action'), items:menu,
            onBack:function(){ Lampa.Controller.toggle(enabled); },
            onSelect:function(a) {
              if (a.mark) params.element.mark(); if (a.unmark) params.element.unmark();
              if (a.timeclear) params.element.timeclear(); if (a.clearallmark) params.onClearAllMark();
              if (a.timeclearall) params.onClearAllTime(); Lampa.Controller.toggle(enabled);
              if (a.player) { Lampa.Player.runas(a.player); params.html.trigger('hover:enter'); }
              if (a.copylink) {
                if (extra.quality) {
                  var qual=[];
                  for (var i in extra.quality) qual.push({ title:i, file:extra.quality[i] });
                  Lampa.Select.show({ title:Lampa.Lang.translate('settings_server_links'), items:qual,
                    onBack:function(){ Lampa.Controller.toggle(enabled); },
                    onSelect:function(b){ Lampa.Utils.copyTextToClipboard(b.file, function(){ Lampa.Noty.show(Lampa.Lang.translate('copy_secuses')); }, function(){ Lampa.Noty.show(Lampa.Lang.translate('copy_error')); }); }
                  });
                } else Lampa.Utils.copyTextToClipboard(extra.file, function(){ Lampa.Noty.show(Lampa.Lang.translate('copy_secuses')); }, function(){ Lampa.Noty.show(Lampa.Lang.translate('copy_error')); });
              }
              if (a.subscribe) { Lampa.Account.subscribeToTranslation({ card:object.movie, season:params.element.season, episode:params.element.translate_episode_end, voice:params.element.translate_voice }, function(){ Lampa.Noty.show(Lampa.Lang.translate('online_voice_success')); }, function(){ Lampa.Noty.show(Lampa.Lang.translate('online_voice_error')); }); }
            }
          });
        }
        params.onFile(show);
      }).on('hover:focus', function() {
        if (Lampa.Helper) Lampa.Helper.show('online_file', Lampa.Lang.translate('helper_online_file'), params.html);
      });
    };
    this.empty = function(msg) {
      var html = Lampa.Template.get('uaflix_plugin_does_not_answer', {});
      html.find('.online-empty__buttons').remove();
      html.find('.online-empty__title').text(Lampa.Lang.translate('empty_title_two'));
      html.find('.online-empty__time').text(Lampa.Lang.translate('empty_text'));
      scroll.append(html); this.loading(false);
    };
    this.doesNotAnswer = function() {
      var _this5 = this; this.reset();
      var html = Lampa.Template.get('uaflix_plugin_does_not_answer', { balanser: sourcesStore.getTitle(balanser) });
      var tic = 10;
      html.find('.cancel').on('hover:enter', function(){ clearInterval(balanser_timer); });
      html.find('.change').on('hover:enter', function(){ clearInterval(balanser_timer); filter.render().find('.filter--sort').trigger('hover:enter'); });
      html.find('.search_all').on('hover:enter', function(){ clearInterval(balanser_timer); _this5.searchAll(); });
      scroll.append(html); this.loading(false);
      balanser_timer = setInterval(function() {
        tic--; html.find('.timeout').text(tic);
        if (tic===0) {
          clearInterval(balanser_timer);
          var keys=filter_sources.slice(0); if (!keys.length) keys=Lampa.Arrays.getKeys(sources);
          var indx=keys.indexOf(balanser); var next=null;
          for (var i=1;i<=keys.length;i++) { var cand=keys[(indx+i)%keys.length]; if (!isSourceDisabled(cand)){ next=cand; break; } }
          if (next&&next!==balanser) { balanser=next; if (Lampa.Activity.active().activity===_this5.activity) _this5.changeBalanser(balanser); }
        }
      }, 1000);
    };
    this.searchAll = function() {
      var _this6=this; this.reset(); this.loading(true);
      var params={ title:object.movie.title||object.movie.name, original_title:object.movie.original_title||object.movie.original_name, imdb_id:object.movie.imdb_id, tmdb_id:getTmdbId(object.movie), kinopoisk_id:object.movie.kinopoisk_id, mal_id:object.movie.mal_id, year:getYear(object.movie) };
      api_client.search(params, filter_sources, function(json) {
        _this6.loading(false);
        if (json&&json.ok&&Array.isArray(json.items)&&json.items.length) _this6.similars(json.items); else _this6.empty();
      }, function(){ _this6.loading(false); _this6.empty(); });
    };
    this.getLastEpisode = function(items) {
      var le=0; items.forEach(function(e){ if (typeof e.episode!=='undefined') le=Math.max(le,parseInt(e.episode)); }); return le;
    };
    this.start = function() {
      if (Lampa.Activity.active().activity!==this.activity) return;
      if (!initialized) { initialized=true; this.initialize(); }
      Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      Lampa.Controller.add('content', {
        toggle:function(){ Lampa.Controller.collectionSet(scroll.render(),files.render()); Lampa.Controller.collectionFocus(last||false,scroll.render()); },
        up:function(){ if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
        down:function(){ Navigator.move('down'); },
        right:function(){ if (Navigator.canmove('right')) Navigator.move('right'); else filter.show(Lampa.Lang.translate('title_filter'),'filter'); },
        left:function(){ if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        gone:function(){ clearInterval(balanser_timer); },
        back:this.back
      });
      Lampa.Controller.toggle('content');
    };
    this.render=function(){ return files.render(); };
    this.back=function(){ Lampa.Activity.backward(); };
    this.pause=function(){ this.stop(); };
    this.stop=function(){ api_client.clear(); clearInterval(balanser_timer); if (source&&source.cancel) source.cancel(); };
    this.destroy=function(){ api_client.clear(); this.clearImages(); files.destroy(); scroll.destroy(); clearInterval(balanser_timer); if (source) source.destroy(); };
  }

  // ─── FILMIX ───────────────────────────────────────────────────────────────
  var FILMIX_POLL_INTERVAL = 10000;
  var FILMIX_MAX_QUALITY_KEY = 'UAFLIX_FILMIX_MAX_QUALITY';
  var AUTH_KEYS = getAuthKeys();
  var api_base = config.api_base;
  var filmixAuthTimer = null;
  var filmixHeaderLoading = false;

  function sanitizeStoredValue(key) { var v=Lampa.Storage.get(key,''); if (v==='undefined'||v==='null') Lampa.Storage.set(key,''); }
  function normalizeValue(value) { return (value||'').toString().trim(); }
  function isVisibleSource(key) { return key && key!=='hdrezka'; }
  function addQuery(url, params) {
    var next=url;
    Object.keys(params||{}).forEach(function(key){ var v=params[key]; if (v===null||typeof v==='undefined'||v==='') return; next=Lampa.Utils.addUrlComponent(next, key+'='+encodeURIComponent(v)); });
    return next;
  }
  function getErrorText(json) { if (!json) return ''; return json.error||json.message||json.error_code||''; }
  function showApiError(json, fallback) { Lampa.Noty.show(getErrorText(json)||Lampa.Lang.translate(fallback)); }
  function normalizeMaxQuality(value) { var p=parseInt(value,10); return isNaN(p)||p<=0?0:p; }
  function getStoredFilmixMaxQuality() { return normalizeMaxQuality(Lampa.Storage.get(FILMIX_MAX_QUALITY_KEY,0)); }
  function setStoredFilmixMaxQuality(value) { var q=normalizeMaxQuality(value); Lampa.Storage.set(FILMIX_MAX_QUALITY_KEY,q||''); return q; }
  function getFilmixTitle(quality) { var base=Lampa.Lang.translate('uaflix_plugin_settings_filmix'); return quality?base+' ('+quality+'p)':base; }
  function setFilmixTitle(item, quality) {
    if (!item||!item.length) return; var text=getFilmixTitle(quality);
    var name=item.find('.settings-param__name'); if (name.length) name.text(text); else item.find('span').first().text(text);
  }
  function setFilmixTokenButtonTitle(item) {
    if (!item||!item.length) return;
    var status=getFilmixToken()?Lampa.Lang.translate('uaflix_plugin_filmix_token_state_set'):Lampa.Lang.translate('uaflix_plugin_filmix_token_state_empty');
    var title=Lampa.Lang.translate('uaflix_plugin_filmix_auth_token')+' ('+status+')';
    var name=item.find('.settings-param__name'); if (name.length) name.text(title);
  }
  function getInternalFilmixDeviceId() { return normalizeValue(getFilmixDeviceId())||normalizeValue(ensureFilmixDeviceId()); }
  function refreshFilmixTitle(item) {
    setFilmixTitle(item, getStoredFilmixMaxQuality());
    var token=getFilmixToken(); if (!token||filmixHeaderLoading) return;
    filmixHeaderLoading=true;
    requestFilmixUser(token, function(json){ filmixHeaderLoading=false; if (!json||!json.ok||!json.authorized) return; var q=setStoredFilmixMaxQuality(json.max_quality); setFilmixTitle(item,q); }, function(){ filmixHeaderLoading=false; });
  }
  function buildSourcesList() {
    var sources=sourcesStore.available_sources;
    if (!sources.length) return $('<div class="settings-param-text">'+Lampa.Lang.translate('uaflix_plugin_sources_empty')+'</div>');
    var hidden=sourcesStore.getHidden(); var sorted=sourcesStore.getSorted();
    var items=sources.map(function(item){ var key=sourcesStore.normalizeName(item.key||item.name); return { key:key, title:sourcesStore.getTitle(key), enabled:item.enabled!==false }; }).filter(function(item){ return isVisibleSource(item.key); });
    if (sorted.length) {
      var ordered=[];
      sorted.forEach(function(key){ var f=items.find(function(i){ return i.key===key; }); if (f) ordered.push(f); });
      items.forEach(function(item){ if (sorted.indexOf(item.key)===-1) ordered.push(item); });
      items=ordered;
    }
    var list=$('<div class="menu-edit-list"></div>');
    items.forEach(function(item) {
      var sk=item.enabled?'uaflix_plugin_sources_enabled':'uaflix_plugin_sources_disabled';
      var status=Lampa.Lang.translate(sk);
      var row=$('<div class="menu-edit-list__item uaflix-plugin-sources__item" data-key="'+item.key+'">' +
        '<div class="menu-edit-list__title uaflix-plugin-sources__title selector">' +
        '<span class="uaflix-plugin-sources__name">'+(item.title||item.key)+'</span>' +
        '<span class="uaflix-plugin-sources__status '+(item.enabled?'is-enabled':'is-disabled')+'">'+status+'</span>' +
        '</div>' +
        '<div class="menu-edit-list__move move-up selector"><svg width="22" height="14" viewBox="0 0 22 14" fill="none"><path d="M2 12L11 3L20 12" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></div>' +
        '<div class="menu-edit-list__move move-down selector"><svg width="22" height="14" viewBox="0 0 22 14" fill="none"><path d="M2 2L11 11L20 2" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></div>' +
        '<div class="menu-edit-list__toggle toggle selector"><svg width="26" height="26" viewBox="0 0 26 26" fill="none"><rect x="1.89" y="1.78" width="21.79" height="21.79" rx="3.5" stroke="currentColor" stroke-width="3"/><path d="M7.45 12.97L10.82 16.33L18.13 9.03" stroke="currentColor" stroke-width="3" class="dot" opacity="0" stroke-linecap="round"/></svg></div>' +
        '</div>');
      row.toggleClass('hidden', hidden.indexOf(item.key)!==-1);
      row.find('.dot').attr('opacity', row.hasClass('hidden')?0:1);
      row.find('.move-up').on('hover:enter', function(){ var prev=row.prev(); if (prev.length) row.insertBefore(prev); });
      row.find('.move-down').on('hover:enter', function(){ var next=row.next(); if (next.length) row.insertAfter(next); });
      row.find('.toggle').on('hover:enter', function(){ row.toggleClass('hidden'); row.find('.dot').attr('opacity',row.hasClass('hidden')?0:1); });
      list.append(row);
    });
    return list;
  }
  function saveSourcesSettings(list) {
    var sort=[]; var hide=[];
    list.find('.uaflix-plugin-sources__item').each(function(){ var key=$(this).data('key'); sort.push(key); if ($(this).hasClass('hidden')) hide.push(key); });
    sourcesStore.saveSorted(sort); sourcesStore.saveHidden(hide);
  }
  function stopFilmixPolling() { if (filmixAuthTimer){ clearInterval(filmixAuthTimer); filmixAuthTimer=null; } }
  function saveFilmixToken(value) {
    var token=normalizeValue(value); setFilmixToken(token); setStoredFilmixMaxQuality(0);
    if (token) { getInternalFilmixDeviceId(); Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_token_saved')); }
    else Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_auth_reset_done'));
    Lampa.Settings.update();
  }
  function openFilmixTokenInput() {
    var current=getFilmixToken();
    if (Lampa.Input && typeof Lampa.Input.edit==='function') {
      Lampa.Input.edit({ title:Lampa.Lang.translate('uaflix_plugin_filmix_auth_token'), value:current, free:true, nosave:true, nomic:true }, function(value){ saveFilmixToken(value); });
      return;
    }
    if (typeof window.prompt!=='function') { Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_auth_error')); return; }
    var next=window.prompt(Lampa.Lang.translate('uaflix_plugin_filmix_auth_token'), current);
    if (next===null) return; saveFilmixToken(next);
  }
  function requestFilmixUser(token, success, fail, deviceIdOverride) {
    var authToken=normalizeValue(token); var deviceId=normalizeValue(deviceIdOverride)||getInternalFilmixDeviceId();
    if (!authToken) { if (fail) fail(Lampa.Lang.translate('uaflix_plugin_filmix_auth_required')); return; }
    if (!deviceId) { if (fail) fail(Lampa.Lang.translate('uaflix_plugin_filmix_auth_error')); return; }
    var network=new Lampa.Reguest();
    var url=addQuery(api_base+'/filmix/user', { token:authToken, device_id:deviceId });
    network.silent(url, function(json){ if (success) success(json); }, function(a,c){ if (fail) fail(network.errorDecode(a,c)); });
  }
  function openFilmixAuthModal(token, userCode, deviceId) {
    stopFilmixPolling();
    var code=normalizeValue(userCode);
    var status=Lampa.Lang.translate('uaflix_plugin_filmix_modal_wait');
    var modal=$('<div><div class="broadcast__text">'+Lampa.Lang.translate('uaflix_plugin_filmix_modal_text')+'</div><div class="broadcast__device selector" style="text-align:center;background-color:darkslategrey;color:white;">'+code+'</div><br><div class="broadcast__scan"><div></div></div><div class="settings-param__descr" style="margin-top:1em;">'+status+'</div></div>');
    var codeEl=modal.find('.broadcast__device'); var statusEl=modal.find('.settings-param__descr');
    codeEl.on('hover:enter', function(){ Lampa.Utils.copyTextToClipboard(code, function(){ Lampa.Noty.show(Lampa.Lang.translate('copy_secuses')); }, function(){ Lampa.Noty.show(Lampa.Lang.translate('copy_error')); }); });
    function closeModal() { stopFilmixPolling(); Lampa.Modal.close(); Lampa.Controller.toggle('settings_component'); }
    function markAuthorized(json) {
      stopFilmixPolling(); setFilmixToken(token); setStoredFilmixMaxQuality(json&&json.max_quality);
      var quality=json&&json.max_quality?json.max_quality+'p':'auto';
      statusEl.text(Lampa.Lang.translate('uaflix_plugin_filmix_modal_success')+' ('+quality+')');
      Lampa.Settings.update(); Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_modal_authorized'));
      setTimeout(closeModal, 500);
    }
    filmixAuthTimer=setInterval(function(){
      requestFilmixUser(token, function(json){ if (!json||!json.ok) return; if (json.authorized) markAuthorized(json); }, null, deviceId);
    }, FILMIX_POLL_INTERVAL);
    Lampa.Modal.open({ title:Lampa.Lang.translate('uaflix_plugin_filmix_modal_title'), html:modal, size:'small', scroll_to_center:true, select:codeEl[0], onBack:function(){ closeModal(); } });
  }
  function startFilmixAuthFlow() {
    var deviceId=Lampa.Utils.uid(16); var network=new Lampa.Reguest();
    var url=addQuery(api_base+'/filmix/key', { device_id:deviceId });
    setFilmixDeviceId(deviceId); setFilmixToken(''); setStoredFilmixMaxQuality(0); Lampa.Settings.update();
    network.silent(url, function(json) {
      if (!json||!json.ok) { showApiError(json,'uaflix_plugin_filmix_auth_error'); return; }
      var token=normalizeValue(json.code); var userCode=normalizeValue(json.user_code);
      if (!token||!userCode) { showApiError(json,'uaflix_plugin_filmix_auth_error'); return; }
      openFilmixAuthModal(token, userCode, deviceId);
    }, function(a,c){ Lampa.Noty.show(network.errorDecode(a,c)); });
  }
  function checkFilmixAuth() {
    var token=getFilmixToken();
    if (!token) { Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_auth_required')); return; }
    requestFilmixUser(token, function(json) {
      if (!json||!json.ok) { showApiError(json,'uaflix_plugin_filmix_auth_error'); return; }
      if (!json.authorized) { Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_auth_unauthorized')); return; }
      setStoredFilmixMaxQuality(json.max_quality); Lampa.Settings.update();
      var quality=json.max_quality?json.max_quality+'p':'auto';
      Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_auth_ok')+' ('+quality+')');
    }, function(text){ Lampa.Noty.show(text||Lampa.Lang.translate('uaflix_plugin_filmix_auth_error')); });
  }
  function resetFilmixAuth() { setFilmixToken(''); setStoredFilmixMaxQuality(0); Lampa.Settings.update(); Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_filmix_auth_reset_done')); }
  function openThanksModal() { openQrModal(); }
  function openSourcesModal() {
    var wrapper=$('<div class="uaflix-plugin-sources"></div>');
    var list=null; var actions=null;
    function buildActions() {
      var container=$('<div class="uaflix-plugin-sources__actions"></div>');
      var syncButton=$('<div class="modal__button uaflix-plugin-sources__action selector"></div>');
      var saveButton=$('<div class="modal__button uaflix-plugin-sources__action selector"></div>');
      syncButton.text(Lampa.Lang.translate('uaflix_plugin_sources_sync'));
      saveButton.text(Lampa.Lang.translate('uaflix_plugin_sources_save'));
      syncButton.on('click hover:enter', sync); saveButton.on('click hover:enter', closeAndSave);
      container.append(syncButton).append(saveButton); return container;
    }
    function render(update_modal) {
      list=buildSourcesList(); if (!actions) actions=buildActions();
      wrapper.empty().append(actions).append(list);
      if (update_modal&&Lampa.Modal&&Lampa.Modal.update) Lampa.Modal.update(wrapper);
    }
    function sync() {
      var network=new Lampa.Reguest();
      network.silent(api_base+'/sources', function(json) {
        if (json&&json.ok&&Array.isArray(json.sources)) { sourcesStore.saveAvailable(json.sources); render(true); Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_sources_sync_success')); }
        else Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_sources_sync_error'));
      }, function(){ Lampa.Noty.show(Lampa.Lang.translate('uaflix_plugin_sources_sync_error')); });
    }
    function closeAndSave() {
      if (list&&list.hasClass('menu-edit-list')) saveSourcesSettings(list);
      Lampa.Modal.close(); Lampa.Controller.toggle('settings_component');
    }
    render();
    Lampa.Modal.open({ title:Lampa.Lang.translate('uaflix_plugin_settings_sources'), html:wrapper, size:'medium', scroll_to_center:true, select:actions&&actions.find('.uaflix-plugin-sources__action')[0], onBack:function(){ closeAndSave(); } });
  }

  function initSettings() {
    var SettingsApi = Lampa.SettingsApi || Lampa.Settings;
    if (!SettingsApi || !SettingsApi.addComponent) return;
    sanitizeStoredValue(AUTH_KEYS.filmixToken); sanitizeStoredValue(AUTH_KEYS.filmixDeviceId); sanitizeStoredValue(FILMIX_MAX_QUALITY_KEY);
    if (getFilmixToken()) getInternalFilmixDeviceId();
    SettingsApi.addComponent({
      component: 'uaflix_plugin',
      name: Lampa.Lang.translate('uaflix_plugin_settings_title'),
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>'
    });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ name:'uaflix_plugin_thanks', type:'button' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_settings_thanks') }, onChange:function(){ openThanksModal(); } });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ name:'uaflix_plugin_sources', type:'button' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_settings_sources') }, onChange:function(){ openSourcesModal(); } });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ type:'title' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_settings_filmix') }, onRender:function(item){ refreshFilmixTitle(item); } });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ name:'uaflix_plugin_filmix_auth_start', type:'button' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_filmix_auth_start') }, onChange:function(){ startFilmixAuthFlow(); } });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ name:'uaflix_plugin_filmix_auth_token', type:'button' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_filmix_auth_token') }, onRender:function(item){ setFilmixTokenButtonTitle(item); }, onChange:function(){ openFilmixTokenInput(); } });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ name:'uaflix_plugin_filmix_auth_check', type:'button' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_filmix_auth_check') }, onChange:function(){ checkFilmixAuth(); } });
    SettingsApi.addParam({ component:'uaflix_plugin', param:{ name:'uaflix_plugin_filmix_auth_reset', type:'button' }, field:{ name:Lampa.Lang.translate('uaflix_plugin_filmix_auth_reset') }, onChange:function(){ resetFilmixAuth(); } });
  }

  // ─── COMMUNITY WATCHES ────────────────────────────────────────────────────
  var communityWatchesPlugin = { url: config.community_watches_url, name: config.community_watches_name, status: 1 };
  var communityWatchesAutoinstallFlag = config.storage_prefixes.cw_autoinstall_done;
  function normalizePluginUrl(url) { return (url||'').toString().trim().replace(/[?#].*$/,'').replace(/\/+$/,'').replace(/^https?:\/\//i,'').toLowerCase(); }
  function isCommunityWatchesInstalled(plugin) {
    if (!plugin) return false;
    if (typeof plugin==='string') return normalizePluginUrl(plugin)===normalizePluginUrl(communityWatchesPlugin.url);
    if (plugin.name===communityWatchesPlugin.name) return true;
    return normalizePluginUrl(plugin.url)===normalizePluginUrl(communityWatchesPlugin.url);
  }
  function cleanupCommunityWatchesDuplicates(plugins) {
    var hasCW=false; var dups=0; var uniq=[];
    plugins.forEach(function(plugin) {
      if (isCommunityWatchesInstalled(plugin)) { if (hasCW) dups++; else { hasCW=true; uniq.push(plugin); } return; }
      uniq.push(plugin);
    });
    return { hasCommunityWatches:hasCW, duplicates:dups, plugins:uniq };
  }
  function ensureCommunityWatchesPlugin() {
    if (Lampa.Storage.get(communityWatchesAutoinstallFlag, false)) return;
    var plugins=Lampa.Storage.get('plugins',[]); if (!Array.isArray(plugins)) plugins=[];
    var state=cleanupCommunityWatchesDuplicates(plugins);
    if (state.duplicates>0) Lampa.Storage.set('plugins', state.plugins);
    if (!state.hasCommunityWatches) Lampa.Plugins.add({ url:communityWatchesPlugin.url, name:communityWatchesPlugin.name, status:communityWatchesPlugin.status });
    Lampa.Storage.set(communityWatchesAutoinstallFlag, true);
  }

  // ─── START PLUGIN ─────────────────────────────────────────────────────────
  function startPlugin() {
    window.uaflix_plugin = true;
    ensureCommunityWatchesPlugin();

    function resetTemplates() {
      Lampa.Template.add('uaflix_plugin_full', '<div class="online-prestige online-prestige--full selector"><div class="online-prestige__img"><img alt=""><div class="online-prestige__loader"></div></div><div class="online-prestige__body"><div class="online-prestige__head"><div class="online-prestige__title">{title}</div><div class="online-prestige__time">{time}</div></div><div class="online-prestige__timeline"></div><div class="online-prestige__footer"><div class="online-prestige__info">{info}</div><div class="online-prestige__quality">{quality}</div></div></div></div>');
      Lampa.Template.add('uaflix_plugin_does_not_answer', '<div class="online-empty"><div class="online-empty__title">#{online_balanser_dont_work}</div><div class="online-empty__time">#{online_balanser_timeout}</div><div class="online-empty__buttons"><div class="online-empty__button selector cancel">#{cancel}</div><div class="online-empty__button selector change">#{online_change_balanser}</div><div class="online-empty__button selector search_all">#{uaflix_plugin_search_all}</div></div><div class="online-empty__templates"><div class="online-empty-template"><div class="online-empty-template__ico"></div><div class="online-empty-template__body"></div></div><div class="online-empty-template"><div class="online-empty-template__ico"></div><div class="online-empty-template__body"></div></div><div class="online-empty-template"><div class="online-empty-template__ico"></div><div class="online-empty-template__body"></div></div></div></div>');
      Lampa.Template.add('uaflix_plugin_rate', '<div class="online-prestige-rate"><svg width="17" height="16" viewBox="0 0 17 16" fill="none"><path d="M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z" fill="#fff"/></svg><span>{rate}</span></div>');
      Lampa.Template.add('uaflix_plugin_folder', '<div class="online-prestige online-prestige--folder selector"><div class="online-prestige__folder"><svg viewBox="0 0 128 112" fill="none"><rect y="20" width="128" height="92" rx="13" fill="white"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/></svg></div><div class="online-prestige__body"><div class="online-prestige__head"><div class="online-prestige__title">{title}</div><div class="online-prestige__time">{time}</div></div><div class="online-prestige__footer"><div class="online-prestige__info">{info}</div></div></div></div>');
      Lampa.Template.add('uaflix_plugin_watched', '<div class="online-prestige online-prestige-watched selector"><div class="online-prestige-watched__icon"><svg width="21" height="21" viewBox="0 0 21 21" fill="none"><circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="3"/><path d="M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z" fill="currentColor"/></svg></div><div class="online-prestige-watched__body"></div></div>');
    }

    var manifest = {
      type: 'video',
      version: '2.8.5',
      name: 'UAFlix',
      component: 'uaflix_plugin',
      onContextMenu: function(object) { return { name: Lampa.Lang.translate('online_watch'), description: '' }; },
      onContextLauch: function(object) {
        resetTemplates();
        Lampa.Component.add('uaflix_plugin', component);
        Lampa.Activity.push({ url:'', title:Lampa.Lang.translate('title_online'), component:'uaflix_plugin', search:object.title, search_one:object.title, search_two:object.original_title, movie:object, page:1 });
      }
    };
    Lampa.Manifest.plugins = manifest;

    Lampa.Lang.add({
      online_watch:{ ru:'Смотреть онлайн', en:'Watch online', ua:'Дивитися онлайн', uk:'Дивитися онлайн', zh:'在线观看' },
      online_no_watch_history:{ ru:'Нет истории просмотра', en:'No browsing history', ua:'Немає історії перегляду', uk:'Немає історії перегляду', zh:'没有浏览历史' },
      online_video:{ ru:'Видео', en:'Video', ua:'Відео', uk:'Відео', zh:'视频' },
      online_nolink:{ ru:'Не удалось извлечь ссылку', uk:'Неможливо отримати посилання', en:'Failed to fetch link', zh:'获取链接失败' },
      online_waitlink:{ ru:'Работаем над извлечением ссылки, подождите...', uk:'Працюємо над отриманням посилання, зачекайте...', en:'Working on extracting the link, please wait...', zh:'正在提取链接，请稍候...' },
      online_balanser:{ ru:'Источник', uk:'Джерело', en:'Source', zh:'来源' },
      helper_online_file:{ ru:'Удерживайте клавишу "ОК" для вызова контекстного меню', uk:'Утримуйте клавішу "ОК" для виклику контекстного меню', en:'Hold the "OK" key to bring up the context menu', zh:'按住"确定"键调出上下文菜单' },
      online_query_start:{ ru:'По запросу', uk:'На запит', en:'On request', zh:'根据要求' },
      online_query_end:{ ru:'нет результатов', uk:'немає результатів', en:'no results', zh:'没有结果' },
      online_voice_subscribe:{ ru:'Подписаться на перевод', uk:'Підписатися на переклад', en:'Subscribe to translation', zh:'订阅翻译' },
      online_voice_success:{ ru:'Вы успешно подписались', uk:'Ви успішно підписалися', en:'You have successfully subscribed', zh:'您已成功订阅' },
      online_voice_error:{ ru:'Возникла ошибка', uk:'Виникла помилка', en:'An error has occurred', zh:'发生了错误' },
      online_clear_all_marks:{ ru:'Очистить все метки', uk:'Очистити всі мітки', en:'Clear all labels', zh:'清除所有标签' },
      online_clear_all_timecodes:{ ru:'Очистить все тайм-коды', uk:'Очистити всі тайм-коди', en:'Clear all timecodes', zh:'清除所有时间代码' },
      online_change_balanser:{ ru:'Изменить балансер', uk:'Змінити балансер', en:'Change balancer', zh:'更改平衡器' },
      online_balanser_dont_work:{ ru:'Балансер ({balanser}) не отвечает на запрос.', uk:'Балансер ({balanser}) не відповідає на запит.', en:'Balancer ({balanser}) does not respond to the request.', zh:'平衡器（{balanser}）未响应请求。' },
      online_balanser_timeout:{ ru:'Балансер будет переключен автоматически через <span class="timeout">10</span> секунд.', uk:'Балансер буде переключено автоматично через <span class="timeout">10</span> секунд.', en:'Balancer will be switched automatically in <span class="timeout">10</span> seconds.', zh:'平衡器将在<span class="timeout">10</span>秒内自动切换。' },
      uaflix_plugin_settings_title:{ ru:'UAFlix', uk:'UAFlix', ua:'UAFlix', en:'UAFlix' },
      uaflix_plugin_settings_thanks:{ ru:'Подяка', uk:'Подяка', ua:'Подяка', en:'Thanks' },
      uaflix_plugin_settings_sources:{ ru:'Джерела', uk:'Джерела', ua:'Джерела', en:'Sources' },
      uaflix_plugin_sources_sync:{ ru:'Синхронізувати джерела', uk:'Синхронізувати джерела', ua:'Синхронізувати джерела', en:'Sync sources' },
      uaflix_plugin_sources_save:{ ru:'Зберегти та закрити', uk:'Зберегти та закрити', ua:'Зберегти та закрити', en:'Save and close' },
      uaflix_plugin_search_all:{ ru:'Поиск по всем источникам', uk:'Пошук по всіх джерелах', ua:'Пошук по всіх джерелах', en:'Search all sources' },
      uaflix_plugin_sources_empty:{ ru:'Список джерел ще не синхронізований.', uk:'Список джерел ще не синхронізований.', ua:'Список джерел ще не синхронізований.', en:'Sources list has not been synced yet.' },
      uaflix_plugin_sources_enabled:{ ru:'Увімкнено', uk:'Увімкнено', ua:'Увімкнено', en:'Enabled' },
      uaflix_plugin_sources_disabled:{ ru:'Мертвий', uk:'Мертвий', ua:'Мертвий', en:'Died' },
      uaflix_plugin_sources_sync_success:{ ru:'Джерела синхронізовано', uk:'Джерела синхронізовано', ua:'Джерела синхронізовано', en:'Sources synced' },
      uaflix_plugin_sources_sync_error:{ ru:'Не вдалося синхронізувати джерела', uk:'Не вдалося синхронізувати джерела', ua:'Не вдалося синхронізувати джерела', en:'Failed to sync sources' },
      uaflix_plugin_settings_filmix:{ ru:'Filmix', uk:'Filmix', ua:'Filmix', en:'Filmix' },
      uaflix_plugin_filmix_auth_start:{ ru:'Запустити Filmix авторизацію (код)', uk:'Запустити Filmix авторизацію (код)', ua:'Запустити Filmix авторизацію (код)', en:'Start Filmix auth (code)' },
      uaflix_plugin_filmix_auth_token:{ ru:'Ввести Filmix token', uk:'Ввести Filmix token', ua:'Ввести Filmix token', en:'Enter Filmix token' },
      uaflix_plugin_filmix_token_state_set:{ ru:'встановлено', uk:'встановлено', ua:'встановлено', en:'set' },
      uaflix_plugin_filmix_token_state_empty:{ ru:'не задано', uk:'не задано', ua:'не задано', en:'not set' },
      uaflix_plugin_filmix_token_saved:{ ru:'Filmix token збережено', uk:'Filmix token збережено', ua:'Filmix token збережено', en:'Filmix token saved' },
      uaflix_plugin_filmix_auth_check:{ ru:'Перевірити Filmix авторизацію', uk:'Перевірити Filmix авторизацію', ua:'Перевірити Filmix авторизацію', en:'Check Filmix auth' },
      uaflix_plugin_filmix_auth_reset:{ ru:'Скинути Filmix token', uk:'Скинути Filmix token', ua:'Скинути Filmix token', en:'Reset Filmix token' },
      uaflix_plugin_filmix_auth_reset_done:{ ru:'Filmix token очищено', uk:'Filmix token очищено', ua:'Filmix token очищено', en:'Filmix token cleared' },
      uaflix_plugin_filmix_auth_required:{ ru:'Для Filmix потрібен token', uk:'Для Filmix потрібен token', ua:'Для Filmix потрібен token', en:'Filmix requires token' },
      uaflix_plugin_filmix_auth_error:{ ru:'Помилка авторизації Filmix', uk:'Помилка авторизації Filmix', ua:'Помилка авторизації Filmix', en:'Filmix auth error' },
      uaflix_plugin_filmix_auth_unauthorized:{ ru:'Filmix: неавторизовано', uk:'Filmix: неавторизовано', ua:'Filmix: неавторизовано', en:'Filmix: unauthorized' },
      uaflix_plugin_filmix_auth_ok:{ ru:'Filmix: авторизація активна', uk:'Filmix: авторизація активна', ua:'Filmix: авторизація активна', en:'Filmix: authorized' },
      uaflix_plugin_filmix_modal_title:{ ru:'Filmix авторизація', uk:'Filmix авторизація', ua:'Filmix авторизація', en:'Filmix authorization' },
      uaflix_plugin_filmix_modal_text:{ ru:'Введіть код на сторінці https://filmix.my/consoles', uk:'Введіть код на сторінці https://filmix.my/consoles', ua:'Введіть код на сторінці https://filmix.my/consoles', en:'Enter code at https://filmix.my/consoles' },
      uaflix_plugin_filmix_modal_wait:{ ru:'Очікуємо підтвердження...', uk:'Очікуємо підтвердження...', ua:'Очікуємо підтвердження...', en:'Waiting for authorization...' },
      uaflix_plugin_filmix_modal_success:{ ru:'Авторизація підтверджена', uk:'Авторизація підтверджена', ua:'Авторизація підтверджена', en:'Authorization confirmed' },
      uaflix_plugin_filmix_modal_authorized:{ ru:'Filmix авторизацію збережено', uk:'Filmix авторизацію збережено', ua:'Filmix авторизацію збережено', en:'Filmix auth saved' }
    });

    initSettings();

    Lampa.Template.add('uaflix_plugin_css', '<style id="uaflix_plugin_style">@charset \'UTF-8\';.online-prestige{position:relative;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:flex;will-change:transform}.online-prestige__body{padding:1.2em;line-height:1.3;flex-grow:1;position:relative}.online-prestige__img{position:relative;width:13em;flex-shrink:0;min-height:8.2em}.online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.3em;opacity:0;transition:opacity .3s}.online-prestige__img--loaded>img{opacity:1}.online-prestige__folder{padding:1em;flex-shrink:0}.online-prestige__folder>svg{width:4.4em!important;height:4.4em!important}.online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);border-radius:100%;padding:.25em;font-size:.76em}.online-prestige__viewed>svg{width:1.5em!important;height:1.5em!important}.online-prestige__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:2em}.online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;background-size:contain}.online-prestige__head,.online-prestige__footer{display:flex;justify-content:space-between;align-items:center}.online-prestige__timeline{margin:.8em 0}.online-prestige__timeline>.time-line{display:block!important}.online-prestige__title{font-size:1.7em;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}.online-prestige__time{padding-left:2em}.online-prestige__info{display:flex;align-items:center}.online-prestige__info>*{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}.online-prestige__quality{padding-left:1em;white-space:nowrap}.online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;flex-shrink:0}.online-prestige.focus::after{content:"";position:absolute;top:-.6em;left:-.6em;right:-.6em;bottom:-.6em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}.online-prestige+.online-prestige{margin-top:1.5em}.online-prestige-watched{padding:1em}.online-prestige-watched__icon>svg{width:1.5em;height:1.5em}.online-prestige-watched__body{padding-left:1em;padding-top:.1em;display:flex;flex-wrap:wrap}.online-prestige-watched__body>span+span::before{content:" ● ";vertical-align:top;display:inline-block;margin:0 .5em}.online-prestige-rate{display:inline-flex;align-items:center}.online-prestige-rate>svg{width:1.3em!important;height:1.3em!important}.online-prestige-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}.online-empty{line-height:1.4}.online-empty__title{font-size:1.8em;margin-bottom:.3em}.online-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}.online-empty__buttons{display:flex}.online-empty__buttons>*+*{margin-left:1em}.online-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;border-radius:.2em;margin-bottom:2.4em}.online-empty__button.focus{background:#fff;color:black}.online-empty-template{background-color:rgba(255,255,255,0.3);padding:1em;display:flex;align-items:center;border-radius:.3em}.online-empty-template>*{background:rgba(0,0,0,0.3);border-radius:.3em}.online-empty-template__ico{width:4em;height:4em;margin-right:2.4em}.online-empty-template__body{height:1.7em;width:70%}.online-empty-template+.online-empty-template{margin-top:1em}.uaflix-plugin-sources__actions{display:flex;justify-content:flex-end;margin-bottom:1.2em;position:sticky;top:0;z-index:2;background:linear-gradient(180deg,#262829 0,rgba(38,40,41,0.92) 100%);padding-bottom:.4em}.uaflix-plugin-sources__action{padding:.7em 1.1em;font-size:1em}.uaflix-plugin-sources__title{display:flex;align-items:center;gap:.6em}.uaflix-plugin-sources__name{font-size:1em;line-height:1.2}.uaflix-plugin-sources__status{font-size:.7em;padding:.2em .5em;border-radius:.3em;color:#fff;text-transform:uppercase;line-height:1}.uaflix-plugin-sources__status.is-enabled{background-color:#46b85a}.uaflix-plugin-sources__status.is-disabled{background-color:#d24a4a}</style>');

    if (!$('#uaflix_plugin_style').length) {
      $('body').append(Lampa.Template.get('uaflix_plugin_css', {}, true));
    }

    var button = '<div class="full-start__button selector view--online view--uaflix-plugin" data-subtitle="UAFlix">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">' +
      '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>' +
      '</svg>' +
      '<span>UAFlix</span>' +
      '</div>';

    Lampa.Component.add('uaflix_plugin', component);
    resetTemplates();

    Lampa.Listener.follow('full', function(e) {
      if (e.type !== 'complite') return;
      var render = e.object.activity.render();
      if (!render || render.find('.view--uaflix-plugin').length) return;
      var btn = $(Lampa.Lang.translate(button));
      btn.on('hover:enter', function() {
        resetTemplates();
        Lampa.Component.add('uaflix_plugin', component);
        Lampa.Activity.push({
          url: '',
          title: 'UAFlix',
          component: 'uaflix_plugin',
          search: e.data.movie.title,
          search_one: e.data.movie.title,
          search_two: e.data.movie.original_title,
          movie: e.data.movie,
          page: 1
        });
      });
      // Insert button as the first (leftmost) button
      var buttons_area = render.find('.full-start__buttons');
      if (buttons_area.length) {
        buttons_area.prepend(btn);
      } else {
        render.find('.view--torrent').before(btn);
      }
    });
  }

  if (!window.uaflix_plugin && Lampa.Manifest.app_digital >= 155) startPlugin();

})();
