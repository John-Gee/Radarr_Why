// ==UserScript==
// @name         SABnzbd – Why This Release?
// @namespace    sab.whythescript
// @version      1.3
// @description  Adds a “Why?” button to SABnzbd rows that fetches matching Radarr history, compares scores, and analyzes bitrate.
// @match        *://*/sabnzbd/*
// @match        *://sabnzbd*.*/*
// @match        *://sab*.*/*
// @match        *://*.lanlabs.org/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

/* ==== CONFIG ==== */
function getConfig() {
	let url = localStorage.getItem("WHY_R_URL");
	let key = localStorage.getItem("WHY_R_KEY");
	
	if (!url || !key) {
		url = prompt("Enter your Radarr URL (e.g. http://localhost:7878):", url || "");
		key = prompt("Enter your Radarr API key:", key || "");
		if (url) localStorage.setItem("WHY_R_URL", url.trim());
		if (key) localStorage.setItem("WHY_R_KEY", key.trim());
	}
	
	return {
		RADARR_URL: url ? url.replace(/\/$/, "") : "",
		API_KEY: key ? key.trim() : ""
	};
}

/* ==== SCORE CACHE ==== */
const SCORE_CACHE = {
	loaded: false,
	map: {}
};

/* ==== HELPERS ==== */
function formatSize(bytes) {
	if (!bytes || isNaN(bytes)) return "-";
	const b = Number(bytes);
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	const i = Math.floor(Math.log(b) / Math.log(1024));
	return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatBitrate(bytes, minutes) {
	if (!bytes || !minutes || minutes <= 0) return "-";
	const bits = bytes * 8;
	const seconds = minutes * 60;
	const mbps = (bits / seconds) / 1000000;
	return `${mbps.toFixed(1)} Mbps`;
}

function formatRuntime(val) {
	if (!val) return { text: "-", min: 0 };
	let mins = 0;
	if (typeof val === 'string' && val.includes(':')) {
		const parts = val.split(':');
		if (parts.length >= 2) mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
	} else {
		mins = Number(val);
	}
	if (isNaN(mins) || mins === 0) return { text: "-", min: 0 };
	
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return { text: `${h}h ${m}m`, min: mins };
}

function normalize(s) {
	return s ? s.toLowerCase().replace(/[\[\]()]/g, "").replace(/\s+/g, " ").trim() : "";
}

function glue(str) {
	if (!str) return "";
	return str.replace(/ /g, "\u00A0").replace(/-/g, "\u2011");
}

function titleCase(str) {
	if (!str) return "";
	return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/* ==== API ==== */
function radarrGet(path) {
	return new Promise((resolve) => {
		const { RADARR_URL, API_KEY } = getConfig();
		const sep = path.includes("?") ? "&" : "?";
		GM_xmlhttpRequest({
			url: `${RADARR_URL}/api/v3/${path}${sep}apiKey=${API_KEY}`,
			method: "GET",
			onload: (res) => {
				try { resolve(JSON.parse(res.responseText)); }
				catch (e) { resolve(null); }
			},
			onerror: () => resolve(null)
		});
	});
}

/* ==== SCORE MANAGER ==== */
async function loadScores() {
	if (SCORE_CACHE.loaded) return;
	const profiles = await radarrGet("qualityprofile");
	if (profiles) {
		profiles.forEach(p => {
			const scores = {};
			p.formatItems.forEach(item => {
				scores[item.format] = item.score;
			});
			SCORE_CACHE.map[p.id] = scores;
		});
		SCORE_CACHE.loaded = true;
	}
}

function getScore(profileId, formatId) {
	if (!SCORE_CACHE.map[profileId]) return 0;
	return SCORE_CACHE.map[profileId][formatId] || 0;
}

/* ==== DETECTORS ==== */
function detectVideo(str) {
	if (!str) return null;
	const s = String(str).toLowerCase();
	if (/av2/.test(s)) return "AV2";
	if (/x266|h\.?266|vvc/.test(s)) return "VVC (H.266)";
	if (/av1/.test(s)) return "AV1";
	if (/x265|h\.?265|hevc/.test(s)) return "HEVC (x265)";
	if (/x264|h\.?264|avc/.test(s)) return "AVC (x264)";
	if (/mpeg-?2/.test(s)) return "MPEG-2";
	if (/vc-?1/.test(s)) return "VC-1";
	return null;
}

function detectAudio(str) {
	if (!str) return null;
	const s = String(str).toLowerCase();
	if (/truehd/.test(s)) return "TrueHD";
	if (/atmos/.test(s)) return "Atmos";
	if (/dts-?hd|dts-?ma/.test(s)) return "DTS-HD MA";
	if (/dts:?x/.test(s)) return "DTS:X";
	if (/eac3|dd\+|ddp/.test(s)) return "DD+";
	if (/ac3|dd5\.1/.test(s)) return "DD 5.1";
	if (/aac/.test(s)) return "AAC";
	if (/flac/.test(s)) return "FLAC";
	if (/mp3/.test(s)) return "MP3";
	return null;
}

function detectChannels(val) {
	if (!val) return null;
	const s = String(val);
	if (/^\d+$/.test(s)) {
		const n = Number(s);
		if (n === 8) return "7.1";
		if (n === 6) return "5.1";
		if (n === 2) return "2.0";
		if (n === 1) return "1.0";
		return s;
	}
	const match = s.match(/\b(\d\.\d)\b/);
	if (match) return match[1];
	return null;
}

function detectEdition(str) {
	if (!str) return null;
	const s = String(str).toLowerCase();
	if (s.includes("remaster")) return "Remastered";
	if (s.includes("restore")) return "Restored";
	if (s.includes("anniversary")) return "Anniversary";
	if (s.includes("extended") || s.includes(" ext ")) return "Extended";
	if (s.includes("director") || s.includes("dir cut")) return "Director's Cut";
	if (s.includes("final cut")) return "Final Cut";
	if (s.includes("theatrical")) return "Theatrical";
	if (s.includes("uncut")) return "Uncut";
	if (s.includes("unrated")) return "Unrated";
	if (s.includes("ultimate")) return "Ultimate";
	if (s.includes("special edition")) return "Special Edition";
	if (s.includes("imax")) return "IMAX";
	if (s.includes("fan edit") || s.includes("fanedit")) return "Fan Edit";
	return null;
}

/* ==== DATA EXTRACTION ==== */
function extractData(rec, profileId) {
	if (!rec) return null;
	
	const d = rec.data || {};
	const m = rec.mediaInfo || {};
	
	const cfList = rec.customFormats || d.customFormats || [];
	const cfObjects = cfList.map(cf => ({
		id: cf.id,
		name: cf.name,
		score: getScore(profileId, cf.id)
	}));
	const cfNames = cfObjects.map(c => c.name);
	const cfs = cfNames.join(", ");
	const guessCFs = cfNames.join(" ");
	
	const sizeBytes = rec.size || d.size;
	const rtObj = formatRuntime(m.runTime || d.runTime || rec.runtime);
	
	// BITRATE
	const bitrate = formatBitrate(sizeBytes, rtObj.min);
	
	let video = detectVideo(m.videoCodec || d.videoCodec);
	let audio = detectAudio(m.audioCodec || d.audioCodec);
	let channels = detectChannels(m.audioChannels || d.audioChannels);
	
	let langs = rec.languages || d.languages || [];
	let languageStr = "Unknown";
	if (Array.isArray(langs) && langs.length > 0) languageStr = langs.map(l => l.name).join(", ");
	else if (d.language) languageStr = d.language;
	
	const guessSource = rec.sourceTitle || "";
	if (guessSource.toLowerCase().includes("dubbed") && !languageStr.toLowerCase().includes("dubbed")) {
		languageStr += " (Dubbed?)";
	}
	
	let edition = rec.edition || d.edition;
	if (!edition || edition.toLowerCase() === "standard") {
		const guessed = detectEdition(guessSource + " " + guessCFs);
		if (guessed) edition = guessed;
	}
	if (!edition) edition = "Standard";
	edition = titleCase(edition);
	const rawEdition = edition;
	
	if (!video) video = detectVideo(guessSource) || detectVideo(guessCFs) || "Unknown";
	if (!audio) audio = detectAudio(guessSource) || detectAudio(guessCFs) || "Unknown";
	if (!channels) channels = detectChannels(guessSource) || "??";
	
	return {
		quality: rec.quality?.quality?.name || "Unknown",
		size: sizeBytes ? formatSize(sizeBytes) : "-",
		bitrate: bitrate,
		language: glue(languageStr),
		edition: edition,
		rawEdition: rawEdition,
		runtime: rtObj.text,
		customFormats: cfs,
		cfList: cfObjects,
		video: glue(video),
		audio: glue(audio),
		channels: glue(channels)
	};
}

/* ==== SMART COMPARISON (RELATIVE) ==== */
function getColors(prop, oldD, newD) {
	const GREEN = "#4caf50";
	const RED = "#f44336";
	const WHITE = "#eee";
	
	if (!oldD) return [WHITE, GREEN];
	
	if (prop === 'edition') {
		const o = oldD.rawEdition;
		const n = newD.rawEdition;
		if (o === n) return [WHITE, WHITE];
		if (o !== "Standard" && n === "Standard") return [GREEN, RED];
		if (o === "Standard" && n !== "Standard") return [RED, GREEN];
		return [WHITE, WHITE];
	}
	
	if (prop === 'video') {
		const oRank = getVideoRank(oldD.video);
		const nRank = getVideoRank(newD.video);
		if (oRank === nRank) return [WHITE, WHITE];
		if (oRank > nRank) return [GREEN, RED];
		if (nRank > oRank) return [RED, GREEN];
	}
	
	if (prop === 'audio') {
		const high = ["TrueHD", "Atmos", "DTS-HD", "DTS:X"];
		const oldHigh = high.some(h => oldD.audio.includes(h));
		const newHigh = high.some(h => newD.audio.includes(h));
		if (oldHigh && !newHigh) return [GREEN, RED];
		if (!oldHigh && newHigh) return [RED, GREEN];
	}
	
	if (prop === 'channels') {
		const o = parseFloat(oldD.channels);
		const n = parseFloat(newD.channels);
		if (!isNaN(o) && !isNaN(n)) {
			if (o > n) return [GREEN, RED];
			if (n > o) return [RED, GREEN];
		}
	}
	
	if (prop === 'quality') {
		if (oldD.quality !== newD.quality) return [RED, GREEN];
	}
	
	return [WHITE, WHITE];
}

function getVideoRank(v) {
	if (!v) return 0;
	const s = v.toLowerCase();
	if (s.includes("av2") || s.includes("vvc") || s.includes("h.266")) return 5;
	if (s.includes("av1")) return 4;
	if (s.includes("hevc") || s.includes("x265")) return 3;
	if (s.includes("avc") || s.includes("x264")) return 2;
	if (s.includes("mpeg") || s.includes("vc")) return 1;
	return 0;
}

/* ==== SMART CUSTOM FORMAT DIFF ==== */
function getFormatHTML(oldCFs, newCFs) {
	const span = (text, color) => `<span style="color:${color}">${text}</span>`;
	const GREEN = "#4caf50";
	const RED = "#f44336";
	const GREY = "#bbb";
	
	const getGroup = (name) => {
		const n = name.split(" ")[0];
		if (["Codec", "Audio", "Provider", "Size", "Upscale", "SDR", "HDR", "Avoid", "Bad"].includes(n)) return n;
		return name;
	};
	
	const oldMap = {};
	const newMap = {};
	const oldGroups = {};
	const newGroups = {};
	
	oldCFs.forEach(c => { oldMap[c.name] = c.score; const g = getGroup(c.name); if(c.score > (oldGroups[g]||-9999)) oldGroups[g] = c.score; });
	newCFs.forEach(c => { newMap[c.name] = c.score; const g = getGroup(c.name); if(c.score > (newGroups[g]||-9999)) newGroups[g] = c.score; });
	
	let oldHtml = "-";
	if (oldCFs.length > 0) {
		oldHtml = oldCFs.map(c => {
			if (newMap.hasOwnProperty(c.name)) return span(c.name, GREY);
			const g = getGroup(c.name);
			const oldScore = c.score;
			const newScore = newGroups[g] !== undefined ? newGroups[g] : -99999;
			if (oldScore > newScore) return span(c.name, GREEN);
			return span(c.name, RED);
		}).join("<br>");
	}
	
	let newHtml = "-";
	if (newCFs.length > 0) {
		newHtml = newCFs.map(c => {
			if (oldMap.hasOwnProperty(c.name)) return span(c.name, GREY);
			const g = getGroup(c.name);
			const newScore = c.score;
			const oldScore = oldGroups[g] !== undefined ? oldGroups[g] : -99999;
			if (newScore > oldScore) return span(c.name, GREEN);
			if (newScore < oldScore) return span(c.name, RED);
			if (oldScore === -99999) return c.score >= 0 ? span(c.name, GREEN) : span(c.name, RED);
			return span(c.name, GREY);
		}).join("<br>");
	}
	
	return [oldHtml, newHtml];
}

/* ==== UI ==== */
function row(label, oldVal, newVal, colors) {
	const [cOld, cNew] = colors;
	const wOld = cOld !== '#eee' ? 'bold' : 'normal';
	const wNew = cNew !== '#eee' ? 'bold' : 'normal';
	const render = (v) => (v === null || v === undefined || v === "") ? "-" : v;
	
	return `
	<tr style="background-color: transparent !important; border:none !important;">
	<td style="width:18%; color:#888; text-align:right; padding:2px 10px 2px 0; vertical-align:top; white-space:nowrap; border:none !important;">${label}</td>
	<td style="width:41%; color:${cOld}; font-weight:${wOld}; padding:2px 5px 2px 0; vertical-align:top; border:none !important;">${render(oldVal)}</td>
	<td style="width:41%; color:${cNew}; font-weight:${wNew}; padding:2px 0; vertical-align:top; border:none !important;">${render(newVal)}</td>
	</tr>`;
}

function formatReason(newGrab, currentFile, movieMeta, profileId) {
	const NEW = extractData(newGrab, profileId);
	const OLD = currentFile ? extractData(currentFile, profileId) : null;
	
	const movieTitle = movieMeta.title || "Unknown";
	const movieYear = movieMeta.year || "";
	
	// Runtime Source: Old file is truth, else metadata
	const rtText = OLD ? OLD.runtime : NEW.runtime;
	
	let html = `
	<div style="font-family:Consolas, Monaco, monospace; font-size:13px; color:#eee;">
	<div style="border-bottom:1px solid #444; padding-bottom:8px; margin-bottom:8px;">
	<div style="font-weight:bold; font-size:14px; color:#fff;">${movieTitle} <span style="color:#888;">(${movieYear})</span></div>
	<div style="color:#888; font-size:12px;">${rtText}</div>
	</div>
	
	<table style="width:100%; border-collapse:collapse; background-color:transparent !important;">
	<thead>
	<tr style="border-bottom:1px solid #333; text-align:left;">
	<th style="padding-bottom:5px; border:none !important;"></th>
	<th style="padding-bottom:5px; color:#888; border:none !important;">OLD</th>
	<th style="padding-bottom:5px; color:#fff; border:none !important;">NEW</th>
	</tr>
	</thead>
	<tbody>
	`;
	
	html += row("Edition", OLD?.edition, NEW.edition, getColors('edition', OLD, NEW));
	html += row("Quality", OLD?.quality, NEW.quality, getColors('quality', OLD, NEW));
	html += row("Size", OLD?.size, NEW.size, ["#eee", "#eee"]);
	html += row("Bitrate", OLD?.bitrate, NEW.bitrate, ["#eee", "#eee"]);
	html += row("Video", OLD?.video, NEW.video, getColors('video', OLD, NEW));
	
	const cAud = getColors('audio', OLD, NEW);
	const cCh = getColors('channels', OLD, NEW);
	let finalOld = "#eee", finalNew = "#eee";
	if (cAud[1] === "#f44336" || cCh[1] === "#f44336") {
		finalOld = "#4caf50"; finalNew = "#f44336";
	} else if (cAud[1] === "#4caf50" || cCh[1] === "#4caf50") {
		finalOld = "#f44336"; finalNew = "#4caf50";
	}
	const oldA = OLD ? `${OLD.audio} ${OLD.channels}` : "-";
	const newA = `${NEW.audio} ${NEW.channels}`;
	html += row("Audio", oldA, newA, [finalOld, finalNew]);
	
	const lCol = (OLD && OLD.language !== NEW.language) ? ["#eee", "#ffd700"] : ["#eee", "#eee"];
	html += row("Lang", OLD?.language, NEW.language, lCol);
	
	if (OLD) {
		const [oldFmt, newFmt] = getFormatHTML(OLD.cfList, NEW.cfList);
		html += row("Formats", oldFmt, newFmt, ["#eee", "#eee"]);
	} else {
		html += row("Formats", "-", NEW.cfList.map(c => c.score > 0 ? `<span style="color:#4caf50">${c.name}</span>` : `<span style="color:#f44336">${c.name}</span>`).join("<br>"), ["#eee", "#eee"]);
	}
	
	html += `</tbody></table>
	<div style="margin-top:15px; border-top:1px solid #444; padding-top:10px; display:flex; justify-content:flex-end;">
	<button id="sab-action-resume" style="background:transparent; border:1px solid #444; color:#4caf50; cursor:pointer; padding:4px 8px; border-radius:3px;">&#9658; Resume</button>
	</div>
	</div>`;
	return html;
}

function popup(htmlContent, rowElement) {
	const box = document.createElement("div");
	Object.assign(box.style, {
		position: "fixed", top: "20px", right: "20px", zIndex: "999999",
		background: "#222", color: "#eee", padding: "15px", border: "1px solid #444",
		borderRadius: "4px", minWidth: "450px", maxWidth: "600px",
		fontFamily: "Consolas, Monaco, monospace", boxShadow: "0 8px 25px rgba(0,0,0,0.8)"
	});
	box.innerHTML = htmlContent;
	
	box.addEventListener('mouseleave', () => box.remove());
	
	const close = document.createElement("div");
	close.innerHTML = "&times;";
	Object.assign(close.style, {
		position: "absolute", top:"5px", right:"8px", cursor:"pointer",
		color:"#888", fontSize:"18px", fontWeight:"bold"
	});
	close.onclick = () => box.remove();
	box.appendChild(close);
	
	document.body.appendChild(box);
	
	setTimeout(() => {
		const btnResume = document.getElementById("sab-action-resume");
		if(btnResume) btnResume.onclick = () => {
			const target = rowElement.querySelector('.grid_resume, [title="Resume"]');
			if(target) { target.click(); box.remove(); }
			else alert("Could not find Resume button on row.");
		};
	}, 100);
}

function ensureWhyHeader() {
	const headerRow = document.querySelector("thead tr");
	if (!headerRow) return;
	if (headerRow.querySelector(".why-col-header")) return;
	const th = document.createElement("th");
	th.className = "why-col-header";
	th.style.width = "40px";
	headerRow.appendChild(th);
}

/* ==== KNOCKOUT.JS BRIDGE ==== */
// Injects a script into the page context to read SABnzbd's internal memory
// and stamp the true category onto the row HTML for our UserScript to read.
const bridge = document.createElement('script');
bridge.textContent = `
const syncSAB = () => {
	if (typeof ko === 'undefined') return;
	document.querySelectorAll('tr.queue-item').forEach(row => {
		try {
			const data = ko.dataFor(row);
			if (data && data.category) {
				const cat = typeof data.category === 'function' ? data.category() : data.category;
				const catStr = cat ? cat.toLowerCase() : '';
				// Only update DOM if it changed, to prevent thrashing
				if (row.getAttribute('data-true-cat') !== catStr) {
					row.setAttribute('data-true-cat', catStr);
				}
			}
		} catch(e) {}
	});
};
syncSAB(); // Run instantly
setInterval(syncSAB, 100); // Sync seamlessly
`;
document.head.appendChild(bridge);

async function patchSab() {
	const sabRows = document.querySelectorAll("tr.queue-item");
	
	sabRows.forEach(row => {
		if (row.querySelector("td.why-col")) return;
		
		const span = row.querySelector("td.name .row-wrap-text span[title]");
		if (!span) return;
		const cleanTitle = span.getAttribute("title").trim();
		
		// Build the UI unconditionally so the table structure doesn't break
		const td = document.createElement("td");
		td.className = "delete why-col";
		td.style.padding = "0 5px";
		td.style.whiteSpace = "nowrap";
		td.style.textAlign = "center";
		
		const btn = document.createElement("button");
		btn.textContent = "Why?";
		btn.style.padding = "2px 6px";
		btn.style.background = "black";
		btn.style.color = "white";
		btn.style.border = "1px solid #666";
		btn.style.borderRadius = "3px";
		btn.style.fontSize = "11px";
		btn.style.cursor = "pointer";
		btn.style.display = "none"; // Hidden until the bridge confirms it's a movie
		
		btn.addEventListener("click", async (e) => {
			e.stopPropagation(); e.preventDefault();
			btn.textContent = "...";
			
			await loadScores();
			
			const hist = await radarrGet("history?page=1&pageSize=500&sortDirection=descending");
			if (!hist || !hist.records) { popup("No Radarr history available.", row); btn.textContent = "Why?"; return; }
			
			const newGrab = hist.records.find(r => normalize(r.sourceTitle || "") === normalize(cleanTitle)) ||
			hist.records.find(r => normalize(r.sourceTitle || "").includes(normalize(cleanTitle)));
			
			if (!newGrab) { popup("No matching Radarr entry found.", row); btn.textContent = "Why?"; return; }
			
			const movie = await radarrGet(`movie/${newGrab.movieId}`);
			if (!movie) { popup("Could not fetch movie details.", row); btn.textContent = "Why?"; return; }
			
			let fullFile = movie.movieFile;
			if (fullFile && fullFile.id) {
				const fetched = await radarrGet(`moviefile/${fullFile.id}`);
				if (fetched) fullFile = fetched;
			}
			
			popup(formatReason(newGrab, fullFile, movie, movie.qualityProfileId), row);
			btn.textContent = "Why?";
		});
		
		td.appendChild(btn);
		row.appendChild(td);
		
		// React instantly to the Knockout Bridge
		const updateButtonVis = () => {
			const trueCategory = row.getAttribute('data-true-cat');
			if (trueCategory !== null) {
				btn.style.display = trueCategory.includes("movie") ? "inline-block" : "none";
			}
		};
		
		// Check immediately in case the bridge already stamped it
		updateButtonVis();
		
		// Watch the row for category changes (hardware accelerated, no polling delay)
		const catObserver = new MutationObserver(updateButtonVis);
		catObserver.observe(row, { attributes: true, attributeFilter: ['data-true-cat'] });
	});
}

new MutationObserver(() => { ensureWhyHeader(); patchSab(); }).observe(document.body, { childList: true, subtree: true });
ensureWhyHeader();
patchSab();
