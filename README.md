# Radarr & SABnzbd — “Why This Release?” Userscripts

These userscripts add a **“Why?”** button next to releases in:

- **Radarr → History**
- **SABnzbd → Queue**

Clicking the button shows a popup explaining **why Radarr chose or upgraded** that specific release, including:

- Quality name  
- Custom Format matches and scores  
- Preferred words  
- Language score  
- Total score  
- Cutoff met / not met  
- Event type (grab, import, upgrade)  
- Timestamp

Both scripts use Radarr’s `/api/v3/history` endpoint with proper query parameters, handle Radarr’s recent API validation changes, and perform safe DOM injection in SAB’s Knockout-driven UI.

---

## Features

### ✔ Radarr
- Adds a “Why?” button beside each history entry  
- Fetches full scoring breakdown  
- Shows Radarr’s real upgrade logic in a clean popup  
- Works reliably with recent API changes (`sortDirection=descending`, paging, etc.)

### ✔ SABnzbd
- Adds a dedicated “Why?” column beside the delete icon  
- Safely injects into SAB’s dynamic Knockout table (no dead buttons)  
- Includes automatic header injection to match table structure  
- Uses the same scoring popup as Radarr  
- Matches titles via Radarr’s `sourceTitle` normalization

---

## Why This Exists

Radarr does not expose upgrade reasoning in the UI.  
SABnzbd shows NZB names but not **why** Radarr grabbed or upgraded them.

These scripts fill that gap with:

- clear explanations  
- score breakdowns  
- robust DOM handling  
- updated API behavior  
- fast, minimal popups

No dependencies. Very lightweight.

---

## Installation

1. Install **Tampermonkey**.  
2. Add the **Radarr** userscript.  
3. Add the **SABnzbd** userscript.  
4. Reload Radarr and SAB.  
5. If prompted, enter your Radarr URL & API key.

---

## Notes

- Radarr history requires valid paging and sorting parameters (`sortDirection=descending`).  
- Both scripts include a correct URL builder so `apiKey` is appended properly whether the path contains a `?` or not.  
- SAB requires a matching `<th>` header for each added column; the script handles this automatically.

---

## License

GNU GPL V3+
