# User guide

Everything in Couch TV is done with the TV remote: the arrow keys, **OK**, **Back** and the
media keys (▶ Play/Pause, ⏪ Rewind, ⏩ Fast-forward, ■ Stop, and the digits).

## Getting around

The **tab bar** across the top lists the main screens, as on Apple TV: Search (magnifier), Home,
Movies, Series, Sports, My List and Settings (gear). Press **Up** at the top of any screen to reach
it. **Left/Right** picks a screen, and **OK** or **Down** opens it. The bar slides away while a screen
is scrolled down and comes back when you return to the top; a title's page has no bar.

**Back** on a title's page returns to the previous screen. On a main screen, **Back** goes up to the
tab bar; **Back** there goes Home, and on Home asks "Exit Couch TV?" (Stay / Exit).

When the TV loses its network connection, a banner at the top says so.

### The Play key works almost everywhere

Pressing **▶ Play** on a title card (Home, Movies, Series, My List, Search, More Like This) opens
the title and starts playing it straight away. A series resumes at the episode you're up to. On
Continue Watching resumes the selected title directly.

## Home

- **Cover:** the backdrop, title, and details follow the focused card. There is no separate featured title.
- **Continue Watching** (first, when available): titles you've started, newest first. **OK** resumes playback directly.
  A finished episode is replaced by the next one.
- **My List**: titles you saved (shown only when the list isn't empty).
- **Because You Watched …**: recommendations based on the last title you watched.
- **Catalog rows**: Trending This Week, Popular Movies, Popular Series, Hindi Movies, Hindi
  Series, Top Rated Movies, Top Rated Series. Rows load more titles as you scroll right.

## Movies and Series

A filter row (All, Hindi, then genres), a sort row (Popular, Top Rated, Newest, A–Z) and a grid
of titles that keeps loading as you scroll down. **Up** from the grid's top row moves to the sorts,
then the filters.

## My List

Everything you added with the **My List** button on a title. Empty until you add something.

## Sports

Sports is cricket and football (soccer) only, from your sports relay and playlists (see [Sources](streaming-provider.md)). **On now**, **Today**, **Upcoming** and **Channels** show
the schedule server's listings plus the cricket and football channels from your configured playlists
(recognised by name, such as Willow, Star Sports, beIN or Premier League; other channels are left out). The screen opens on the first of these with something in it. A sport
filter sits above the grid; it lists only the sports in the current view, most listed first, and hides
when there is just one. Feeds in every commentary language are listed, English, Hindi and Nepali first.
Availability of Hindi or Nepali commentary depends on the providers; it is not inferred from a team or
channel name. Times use the
TV's configured local timezone.

Cards count down to events starting within a day (**In 3 h 10 min**), and the line under the grid
shows the focused card's watch options, languages and how long ago it started or until it starts.
Today lists events scheduled now first, then later ones, then finished ones. When nothing is on, On now
names the next event. Channels lists the schedule server's sports channels first, then its other 24/7
streams, then your playlists.

Use **Up/Down** between view tabs, sport and the grid, and **Left/Right** within each.
**OK** on a match or channel opens its watch options; **Play** starts the first one (English, Hindi or
Nepali commentary when listed) straight away. Upcoming events more than 15 minutes away show their start time instead of
opening a player. **Scheduled now** describes the provider's time window, not a verified live match
status. Unknown end times are not invented: an event without one stays in On now for its sport's usual
length (2.5 h for football, 8 h for cricket), then
shows **Status unknown** in Today.

**OK** also offers **Add to My Sports** (or **Remove from My Sports**). Saved channels and matches show a ★,
saved channels come first in Channels, and all of them appear in the Home launcher's **My Sports** row. For a
match more than 15 minutes away, **OK** offers **Remind me on the Home screen** instead: the launcher shows a
banner from 10 minutes before kick-off, and Couch TV shows a message 5 minutes before if it's open. A saved
match leaves the list 12 hours after it starts.

Alternate feeds are grouped under their event. If a selected feed fails, the player tries up to two
other feeds before showing its error. **Back** closes playback and returns to the current selection.
Some feeds take a few seconds to start. Sources can be offline or geographically restricted.

Schedules refresh every minute while this screen is open, preserving the focused event; if the
schedule server can't be reached, the next try is after 10 seconds. A provider failure keeps the other
providers available and retains stale listings for up to six hours, labeled with when they were last
updated. If schedules cannot load, Channels can still work from the configured playlists.

## Search

Type with the on-screen keyboard (arrows + **OK**). Results appear half a second after you stop
typing. **Back** deletes a character, and leaves Search only when the query is empty. **Right**
from the keyboard's right edge moves into the results.

With an empty query, Search shows your recent searches (OK runs one again) and what's popular
right now. A search is remembered as "recent" once you open one of its results.

## Title details

- **Play / Resume**: films resume where you stopped (shown as a time). Series show the episode,
  for example "Resume S2 E4".
- **Start Over**: appears once you've watched part of the title.
- **My List**: adds or removes the title.
- **Episodes** (series): season tabs, then the episode list with each episode's length, synopsis,
  a progress bar for episodes you've started, and a **CC** badge when it has subtitles. The page
  opens on the season you're watching. **OK** on an episode plays it.
- **More Like This**: related titles. **OK** opens one; **Back** returns here.

## Watching

Press any key to show the controls. They hide after a few seconds.

| Key | What it does |
|---|---|
| OK | Play / pause (with the progress bar focused) |
| ▶ Play/Pause, Play, Pause | Play / pause |
| Left / Right | Seek back / forward (hold to go faster). Seeking starts after a short pause |
| ⏪ / ⏩ | Seek in bigger steps |
| 0–9 | Jump to 0 %, 10 % … 90 % of the title |
| Down | Move from the progress bar to the buttons |
| Up | Back to the progress bar |
| Back | Dismiss Up Next → hide the controls → close the player |
| ■ Stop | Close the player |

The buttons row has: Pause, Back 10 s, Forward 10 s, Subtitles (when the title has subtitles),
Next episode, Episodes, Quality, Start from beginning and Info.

- **Subtitles** (**Audio and subtitles** when the file has more than one spoken language): choose a
  language, a subtitle track or Off. The language you pick is used for later titles that have it.
- **Quality**: lists the resolutions the stream offers. Choosing one reopens the stream at the
  same point and becomes your default.
- **Up Next**: near the end of an episode a card shows the next one. With autoplay on, it counts
  down from 10 and plays it; **OK** plays it now and **Back** dismisses it.
- If a stream fails, the player tries the next source for the title automatically, from the same
  point.

Progress is saved every few seconds and when you close the player. A title counts as finished
after 95 %. Resuming backs up 5 seconds so you don't miss a line.

## Settings

| Section | Setting | What it does |
|---|---|---|
| Playback | Video quality | Best available, 1080p, 720p or 480p. Lower it if playback stutters |
| Playback | Autoplay next episode | Starts the next episode after a 10 s countdown |
| Playback | Sleep timer | Turns the TV off after 15, 30, 60, 90 or 120 minutes, even mid-film. The Home launcher keeps the timer (it also sets it), so it runs in any app |
| Sources | Source order | Add-ons first (default) or Stream server first; failures try the next source |
| Sources | Torrent server | Shows Connected or Not reachable. OK tests again |
| Subtitles | Show subtitles | Turns subtitles on automatically when a title has them |
| Subtitles | Subtitle size | Small, Medium or Large, with a live preview |
| Display | Remove animations | Turns off fades, slides and zooms so everything changes instantly. Loading indicators still move |
| Library | Clear watch history | Empties Continue Watching and forgets resume points (asks first) |
| Library | Clear My List | Removes every saved title (asks first) |
| Library | Clear recent searches | Forgets the recent searches |
| Library | Refresh catalog and artwork | Drops the cached Home rows and artwork; they reload on the next visit to Home |
| Connection | Stream server | Shows whether the stream server answers, and how fast. OK tests again |
| Connection | Sports streams | Whether this TV can still find sports streams: Working, Failing (with the reason) or Not reachable. OK tests with a live channel now (up to a minute) |
| Connection | App health | The last unexpected errors, for troubleshooting. OK clears the list |

## When something goes wrong

| Problem | Try |
|---|---|
| "Can't reach the stream server" | Check that the provider server is running (Settings → Stream server) |
| "No stream found for this title" | That title has no source right now; try another one |
| Playback stutters | Settings → Video quality → 720p or 480p |
| Rows or artwork look stale | Settings → Refresh catalog and artwork |
| A row says "Couldn't load" | Focus it and press OK to retry |
