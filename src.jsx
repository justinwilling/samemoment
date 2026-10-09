import { prepareImage, IMAGE_ACCEPT } from "./image-processing.js";
import PlaceSearch from "./PlaceSearch.jsx";
import LegalPages from "./LegalPages.jsx";
import { localDay, cameraDate } from "./day.js";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import exifr from "exifr";
import {
  db,
  findPhotos,
  publishPhoto,
  getProfile,
  saveProfile,
  getMyPhotos,
  getRecommendations,
  uploadAvatar,
  getAllPhotos,
  followUser,
  PAGE_SIZE,
} from "./backend.js";
import {
  MapPin,
  Upload,
  CalendarDays,
  Search,
  X,
  Images,
  LocateFixed,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./style.css";

const photoPin = (photo, active = false) => L.divIcon({ className: active ? "photoPin activePhotoPin" : "photoPin", html: `<img src="${photo.image_url}" alt=""/>`, iconSize: [48,48], iconAnchor: [24,24] });
const pin = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
function Picker({ value, onChange }) {
  useMapEvents({ click: (e) => onChange([e.latlng.lat, e.latlng.lng]) });
  return value ? <Marker position={value} icon={pin} /> : null;
}
function MapBoundsWatcher({ onChange, onInteraction }) { const map = useMapEvents({ dragstart: onInteraction, zoomstart: onInteraction, moveend: () => onChange(map.getBounds()), zoomend: () => onChange(map.getBounds()), dragend: () => onChange(map.getBounds()) }); useEffect(() => { onChange(map.getBounds()); }, [map, onChange]); return null; }
function EnableMapDragging() { const map = useMap(); useEffect(() => { map.dragging.enable(); }, [map]); return null; }
function CenterMapOn({ target }) { const map = useMap(); useEffect(() => { if (target) { const zoom = map.getZoom(); const point = map.project([target.lat, target.lng], zoom); const center = map.unproject([point.x, point.y - map.getSize().y * 0.1], zoom); map.setView(center, zoom, { animate:true, duration:1.1 }); } }, [map, target]); return null; }
function MapCameraFocus({ target }) { const map = useMap(); useEffect(() => { if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 7), { animate:true, duration:1.2 });  }, [map, target]); return null; }
function SearchMapFocus({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target.position, 15, { animate: false });
  }, [map, target]);
  return null;
}
const demo = [
  {
    id: "demo1",
    title: "Golden hour in Paris",
    lat: 48.8584,
    lng: 2.2945,
    taken_at: "2025-08-15T19:30:00Z",
    image_url:
      "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900",
    author: "Community",
  },
  {
    id: "demo2",
    title: "New York am Abend",
    lat: 40.758,
    lng: -73.9855,
    taken_at: "2025-09-12T22:00:00Z",
    image_url:
      "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=900",
    author: "Community",
  },
  {
    id: "demo3",
    title: "Tokyo Nights",
    lat: 35.6595,
    lng: 139.7005,
    taken_at: "2025-04-11T18:30:00Z",
    image_url:
      "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=900",
    author: "Community",
  },
];
function distance(a, b, c, d) {
  const r = Math.PI / 180,
    x = (c - a) * r,
    y = (d - b) * r,
    z =
      Math.sin(x / 2) ** 2 +
      Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(z), Math.sqrt(1 - z));
}
function shuffle(items) { return [...items].sort(() => Math.random() - 0.5); }
function groupByPlace(items) { const groups = new Map(); items.forEach((photo) => { const key = `${photo.lat.toFixed(2)}:${photo.lng.toFixed(2)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(photo); }); return [...groups.values()]; }
const MAJOR_CITIES = [[52.52,13.405],[48.8566,2.3522],[51.5074,-0.1278],[40.7128,-74.006],[34.0522,-118.2437],[41.8781,-87.6298],[35.6762,139.6503],[31.2304,121.4737],[19.076,72.8777],[25.2048,55.2708],[1.3521,103.8198],[55.7558,37.6173],[41.0082,28.9784],[40.4168,-3.7038],[45.4642,9.19],[52.3676,4.9041],[59.3293,18.0686],[39.9042,116.4074],[37.5665,126.978],[22.3193,114.1694]];
function isMajorCity(photo) { return MAJOR_CITIES.some(([lat,lng]) => distance(photo.lat, photo.lng, lat, lng) < 30000); }

function App() {
  const selectionVersion = useRef(0);
  const markerRefs = useRef(new Map());
  const activeMarkerRef = useRef(null);
  const suppressBounds = useRef(false);
  const [legalPage, setLegalPage] = useState(() => ["impressum", "datenschutz", "agb", "kontakt"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : null);
  const [user, setUser] = useState(null),
    [email, setEmail] = useState(""),
    [username, setUsername] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [photos, setPhotos] = useState(db ? [] : demo),
    [allPhotos, setAllPhotos] = useState(db ? [] : demo),
    [modal, setModal] = useState(false),
    [file, setFile] = useState(null),
    [batchFiles, setBatchFiles] = useState([]),
    [preparing, setPreparing] = useState(false),
    [imageInfo, setImageInfo] = useState(null),
    [preview, setPreview] = useState(""),
    [batchPreviews, setBatchPreviews] = useState([]),
    [title, setTitle] = useState(""),
    [taken, setTaken] = useState(""),
    [pos, setPos] = useState(null),
    [focus, setFocus] = useState(null),
    [searchTarget, setSearchTarget] = useState(null),
    [radius, setRadius] = useState(200),
    [date, setDate] = useState(() => localDay()),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(null),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [profile, setProfile] = useState(null),
    [displayName, setDisplayName] = useState(""),
    [myPhotos, setMyPhotos] = useState([]),
    [profileBusy, setProfileBusy] = useState(false), [recommendations, setRecommendations] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0), [detailPhoto, setDetailPhoto] = useState(null), [fullScreenPhoto, setFullScreenPhoto] = useState(null), [editingProfile, setEditingProfile] = useState(false), [avatarBusy, setAvatarBusy] = useState(false), [activeTab, setActiveTab] = useState("profile"), [profileMenuOpen, setProfileMenuOpen] = useState(false), [activeNav, setActiveNav] = useState("discover"), [showMine, setShowMine] = useState(false), [activeMap, setActiveMap] = useState(null), [profileFocus, setProfileFocus] = useState(null), [communityFocus, setCommunityFocus] = useState(null), [mapFocus, setMapFocus] = useState(null), [gridCenter, setGridCenter] = useState(null), [placeFocus, setPlaceFocus] = useState(null), [mapBounds, setMapBounds] = useState(null), [selectedFromGrid, setSelectedFromGrid] = useState(false), [openPlaceKey, setOpenPlaceKey] = useState(null), [likedIds, setLikedIds] = useState([]), [commentText, setCommentText] = useState(""), [comments, setComments] = useState([]), [socialQuery, setSocialQuery] = useState(""), [feedFilter, setFeedFilter] = useState("all"), [gridView, setGridView] = useState("photos"), [feedPage, setFeedPage] = useState(0), [mapCompact, setMapCompact] = useState(false), [searchOpen, setSearchOpen] = useState(false), [searchPos, setSearchPos] = useState(null), [searchPlace, setSearchPlace] = useState(""), [searchUser, setSearchUser] = useState(""), [searchFrom, setSearchFrom] = useState(""), [searchTo, setSearchTo] = useState(""), [searchRadius, setSearchRadius] = useState("");
  const [authOpen, setAuthOpen] = useState(false),
    [authMode, setAuthMode] = useState("login"),
    [password, setPassword] = useState(""),
    [confirmationPending, setConfirmationPending] = useState(false),
    [accountConsent, setAccountConsent] = useState(false),
    [uploadConsent, setUploadConsent] = useState(false),
    [safeContentConsent, setSafeContentConsent] = useState(false);
  useEffect(() => {
    const syncLegalHash = () => { const page = window.location.hash.slice(1); setLegalPage(["impressum", "datenschutz", "agb", "kontakt"].includes(page) ? page : null); };
    window.addEventListener("hashchange", syncLegalHash);
    return () => window.removeEventListener("hashchange", syncLegalHash);
  }, []);
  useEffect(() => {
    if (!db) return;
    db.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user || null),
    );
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!db) return;
    getAllPhotos().then(setAllPhotos).catch((e) => setNotice(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!user || !db) {
      setProfile(null);
      setMyPhotos([]);
      return;
    }
    Promise.all([getProfile(user.id), getMyPhotos(user.id), getRecommendations()])
      .then(([p, photos]) => {
        setProfile(p);
        setUsername(p?.username || "");
        setDisplayName(p?.display_name || "");
        setMyPhotos(photos);
      })
      .catch((e) => setNotice(e.message));
  }, [user, refresh]);
  async function updateProfile() {
    setProfileBusy(true);
    try {
      const value = await saveProfile(user.id, username, displayName);
      setProfile(value);
      setNotice("Profil gespeichert.");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setProfileBusy(false);
    }
  }
  useEffect(() => {
    if (!db) return;
    const controller = new AbortController();
    setLoading(true);
    setPhotos([]);
    setHasMore(false);
    const timer = setTimeout(async () => {
      try {
        const allRows = [];
        let currentPage = page;
        while (!controller.signal.aborted) {
          const rows = await findPhotos({ focus, radius, date, page: currentPage, signal: controller.signal });
          allRows.push(...rows);
          if (rows.length < PAGE_SIZE) break;
          currentPage += 1;
        }
        if (controller.signal.aborted) return;
        setPhotos(allRows);
        setHasMore(false);
      } catch (error) {
        if (!controller.signal.aborted) setNotice("Fotos konnten nicht geladen werden: " + error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [focus, radius, date, page, refresh]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function choose(input) {
    const selectedFiles = Array.from(input?.length ? input : input ? [input] : []);
    if (!selectedFiles.length) return;
    const f = selectedFiles[0];
    const version = ++selectionVersion.current;
    setPreparing(true);
    setFile(null);
    setBatchFiles([]);
    setPreview("");
    setBatchPreviews([]);
    setImageInfo(null);
    setPos(null);
    setTaken("");
    setNotice("");
    setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
    try {
      const converted = await prepareImage(f);
      if (version !== selectionVersion.current) return;
      let ex;
      try {
        ex = await exifr.parse(f, { gps: true, exif: true });
      } catch {}
      if (version !== selectionVersion.current) return;
      if (ex?.latitude != null && ex?.longitude != null)
        setPos([ex.latitude, ex.longitude]);
      const dt = ex?.DateTimeOriginal || ex?.CreateDate;
      if (dt instanceof Date && !isNaN(dt))
        setTaken(
          new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16),
        );
      const prepared = [converted];
      for (const extra of selectedFiles.slice(1)) prepared.push(await prepareImage(extra));
      if (version !== selectionVersion.current) return;
      setFile(converted.blob);
      setBatchFiles(prepared.map((item) => item.blob));
      setPreview(URL.createObjectURL(converted.blob));
      setBatchPreviews(prepared.map((item) => URL.createObjectURL(item.blob)));
      setImageInfo({...converted, count: prepared.length});
    } catch (error) {
      if (version === selectionVersion.current) setNotice(error.message);
    } finally {
      if (version === selectionVersion.current) setPreparing(false);
    }
  }
  function openUpload() {
    if (!user) {
      setAuthMode("login");
      setAuthOpen(true);
    } else { setActiveNav("upload"); setModal(true); }
  }
  async function login() {
    if (!db) {
      setNotice("Supabase ist nicht konfiguriert.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 8) {
      setNotice("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (authMode === "signup" && !/^[a-z0-9_]{3,24}$/i.test(username.trim())) {
      setNotice("Bitte einen Nutzernamen mit 3–24 Zeichen eingeben (Buchstaben, Zahlen, _).");
      return;
    }
    if (authMode === "signup" && !accountConsent) {
      setNotice("Bitte bestätige die Nutzungsbedingungen und Community-Regeln.");
      return;
    }
    setAuthBusy(true);
    try {
      const result = authMode === "signup"
        ? await db.auth.signUp({ email: email.trim(), password, options: { data: { username: username.trim().toLowerCase() } } })
        : await db.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) setNotice(result.error.message);
      else if (authMode === "signup" && result.data.user && !result.data.session) { setConfirmationPending(true); setNotice("Bestätigungs-E-Mail gesendet. Prüfe auch den Spam-Ordner."); }
      else {
        if (authMode === "signup" && result.data.user && result.data.session) {
          try { await saveProfile(result.data.user.id, username, ""); } catch (profileError) { setNotice(profileError.message); }
        }
        setNotice(authMode === "signup" ? "Konto erstellt." : "Willkommen zurück."); setAuthOpen(false);
      }
      if (!result.error && result.data.session) { setAuthOpen(false); setPassword(""); }
    } catch (error) {
      setNotice("Anmeldung fehlgeschlagen: " + error.message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function resendConfirmation() {
    const { error } = await db.auth.resend({ type: "signup", email: email.trim() });
    setNotice(error ? error.message : "Bestätigungs-E-Mail erneut gesendet. Prüfe auch den Spam-Ordner.");
  }
  async function logout() {
    const { error } = await db.auth.signOut();
    setNotice(error ? error.message : "Abgemeldet.");
  }
  async function upload() {
    if (!file || !pos || !taken || !title.trim()) {
      setNotice("Bitte Foto, Titel, Aufnahmedatum und Standort angeben.");
      return;
    }
    if (!db) {
      setNotice("Bitte Supabase konfigurieren (README).");
      return;
    }
    if (!user) {
      setNotice("Bitte zuerst per E-Mail anmelden.");
      return;
    }
    if (!uploadConsent || !safeContentConsent) {
      setNotice("Bitte bestätige Bildrechte, Veröffentlichung und Community-Regeln.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const blob = file;
      if (blob.size > 5 * 1024 * 1024)
        throw new Error("Komprimiertes Foto ist zu groß (max. 5 MB).");
      const uploads = batchFiles.length ? batchFiles : [blob];
      for (let index = 0; index < uploads.length; index++) {
        await publishPhoto({ blob: uploads[index], title: uploads.length > 1 ? `${title.trim()} ${index + 1}` : title.trim(), pos, taken });
      }
      setPage(0);
      setRefresh((v) => v + 1);
      setModal(false);
      setFile(null);
      setBatchFiles([]);
      setPreview("");
      setBatchPreviews([]);
      setUploadConsent(false);
      setSafeContentConsent(false);
      setNotice("Foto veröffentlicht!");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  const shuffledAll = useMemo(() => shuffle(allPhotos.length ? allPhotos : demo), [allPhotos]);
  const shuffledMine = useMemo(() => shuffle(myPhotos), [myPhotos]);
  const filtered = db
    ? photos
    : photos.filter(
        (p) =>
          (!focus || distance(focus[0], focus[1], p.lat, p.lng) <= radius) &&
          localDay(p.taken_at) === date,
      );
  useEffect(() => {
    const query = searchPlace.trim().toLowerCase();
    if (!query) return;
    const source = showMine ? myPhotos : allPhotos;
    const match = source.find((photo) => `${photo.title || ""} ${photo.author || ""}`.toLowerCase().includes(query));
    if (match) { setSelected(match); setSelectedFromGrid(false); setCommunityFocus(match); setMapFocus(match); setGridCenter(match); setOpenPlaceKey(`${match.lat.toFixed(2)}:${match.lng.toFixed(2)}`); }
  }, [searchPlace, showMine, myPhotos, allPhotos]);

  useEffect(() => {
    if (!selected) {
      const first = (showMine ? shuffledMine : shuffledAll)[0];
      if (first) setSelected(first);
    }
  }, [selected, showMine, shuffledMine, shuffledAll]);

  useEffect(() => {
    const onScroll = () => setMapCompact(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header className={user ? "socialHeader" : ""}>
        <div className="brand">
          <span>
            same<span className="accent">moment</span>
          </span>
        </div>
        <div className="accountTop">{user && <a href="#profile" className="accountProfile">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span className="miniAvatar">{(profile?.username || "N").slice(0,1).toUpperCase()}</span>}<span>Hey {profile?.username || "Nutzer"}</span></a>}</div>
        <nav>
          <a href="#explore">Entdecken</a>
          <a href="#how">So funktioniert's</a>
          {user ? (
            <button className="secondary" onClick={logout}>
              Abmelden
            </button>
          ) : (
            <button
              className="secondary"
              onClick={() => { setAuthMode("login"); setAuthOpen(true); }}
            >
              Anmelden
            </button>
          )}
        </nav>
      </header>
      {user && <section className={`socialWorkspace ${selected ? "hasDetail" : "noDetail"}`}><aside className="socialRail"><div className="railLogo">same<br/><b>moment</b></div><button className={activeNav === "discover" ? "railActive" : ""} onClick={() => { setModal(false); setActiveNav("discover"); setShowMine(false); setSelected(null); setCommunityFocus(null); setMapFocus(null); setGridCenter(null); setPlaceFocus(null); setOpenPlaceKey(null); document.getElementById("socialMap")?.scrollIntoView({behavior:"smooth"}); }}>◉ Entdecken</button><button className={activeNav === "mine" ? "railActive" : ""} onClick={() => { setModal(false); setActiveNav("mine"); setShowMine(true); setSelected(null); setCommunityFocus(null); setMapFocus(null); setGridCenter(null); setPlaceFocus(null); setOpenPlaceKey(null); document.getElementById("socialGrid")?.scrollIntoView({behavior:"smooth"}); }}>▤ Deine Momente</button><button className={activeNav === "upload" ? "railActive" : ""} onClick={openUpload}>＋ Hochladen</button><div className="railRule"/><small>COMMUNITY</small><button className={activeNav === "activity" ? "railActive" : ""} onClick={() => { setActiveNav("activity"); setSearchOpen(false); document.getElementById("recommend-feed")?.scrollIntoView({behavior:"smooth"}); }}>♧ Aktivität</button><button className={activeNav === "search" ? "railActive" : ""} onClick={() => { setActiveNav("search"); setSearchOpen(true); }}>⌕ Suche</button><div className="railProfileWrap"><button className="railUser" onClick={() => { setProfileMenuOpen((open) => !open); setModal(false); setActiveNav("profile"); setShowMine(true); document.getElementById("socialGrid")?.scrollIntoView({behavior:"smooth"}); }}>{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : <span>{(profile?.username || "N").slice(0,1).toUpperCase()}</span>} {profile?.username || "Nutzer"}</button>{profileMenuOpen && <button className="railLogout" onClick={logout}>Abmelden</button>}</div></aside><div className="socialMain"><div className={`socialSearch ${activeNav === "search" ? "searchActive" : ""}`}><div className="searchMain"><span>⌕</span><span>Suche über die linke Navigation</span></div><div className="searchAdvanced"><input value={searchPlace} onChange={(e)=>setSearchPlace(e.target.value)} placeholder="Ort"/><input type="date" value={searchFrom} onChange={(e)=>setSearchFrom(e.target.value)} aria-label="Von"/><input type="date" value={searchTo} onChange={(e)=>setSearchTo(e.target.value)} aria-label="Bis"/><input type="number" min="1" max="5000" value={searchRadius} onChange={(e)=>setSearchRadius(e.target.value)} placeholder="Radius km"/><input value={searchUser} onChange={(e)=>setSearchUser(e.target.value)} placeholder="Nutzer"/></div></div><div className="profileSummary" style={{display: activeNav === "profile" ? "flex" : "none"}}><div className="profileSummaryAvatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : (profile?.username || "N").slice(0,1).toUpperCase()}</div><div className="profileSummaryMain"><h2>{profile?.username || "Dein Profil"}</h2><div className="profileStats"><span><strong>{profile?.followers_count || 0}</strong> Follower</span><span><strong>{likedIds.length}</strong> Likes</span><span><strong>{myPhotos.length}</strong> Momente</span></div><small>Mitglied seit {profile?.created_at ? new Date(profile.created_at).toLocaleDateString("de-DE", {month:"long", year:"numeric"}) : "2026"}</small></div></div><div className={`socialMap ${mapCompact ? "mapCompact" : ""} ${mapCompact && !selected && !openPlaceKey ? "mapHidden" : ""}`} id="socialMap" onMouseLeave={() => { markerRefs.current.forEach((marker) => marker.closeTooltip()); setOpenPlaceKey(null); activeMarkerRef.current = null; }}><MapContainer center={[20,0]} zoom={1} minZoom={1} maxZoom={18} maxBounds={[[-85,-180],[85,180]]} maxBoundsViscosity={1} worldCopyJump={false} noWrap={true} scrollWheelZoom={false} dragging={true} onClick={(event) => { setActiveMap("social"); const source = showMine ? myPhotos : allPhotos; const hit = source.reduce((best, photo) => { const d = Math.hypot(photo.lat - event.latlng.lat, photo.lng - event.latlng.lng); return !best || d < best.d ? {photo, d} : best; }, null); if (hit && hit.d < 4) { setSelected(hit.photo); setSelectedFromGrid(false); setCommunityFocus(hit.photo); setMapFocus(hit.photo); setOpenPlaceKey(`${hit.photo.lat.toFixed(2)}:${hit.photo.lng.toFixed(2)}`); } }} style={{height:"100%"}}><MapCameraFocus target={communityFocus}/><CenterMapOn target={gridCenter}/><EnableMapDragging/><MapBoundsWatcher onChange={(bounds) => { if (suppressBounds.current) { return; } setMapBounds(bounds); }} onInteraction={() => { setPlaceFocus(null); setMapFocus(null); setOpenPlaceKey(null); }}/><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{groupByPlace((showMine ? myPhotos : allPhotos).filter((photo) => feedFilter === "all" || (feedFilter === "cities" && isMajorCity(photo)) || (feedFilter === "recent" && photo.taken_at && new Date(photo.taken_at).getTime() >= Date.now() - 30 * 86400000) || feedFilter === "random").slice(0, feedFilter === "random" ? 50 : undefined)).map((group)=><Marker ref={(marker) => { const key = `${group[0].lat.toFixed(2)}:${group[0].lng.toFixed(2)}`; if (marker) markerRefs.current.set(key, marker); }} key={group[0].id} position={[group[0].lat,group[0].lng]} icon={photoPin(group[0])} interactive={true} eventHandlers={{mouseover:(event)=>{ markerRefs.current.forEach((marker) => { if (marker !== event.target) marker.closeTooltip(); }); event.target._map?.panInside(event.target.getLatLng(), {paddingTopLeft:[180,420], paddingBottomRight:[180,120], animate:true}); }, mouseout:(event)=>{ const key = `${group[0].lat.toFixed(2)}:${group[0].lng.toFixed(2)}`; if (activeMarkerRef.current !== key) window.setTimeout(() => event.target.closeTooltip(), 120); }, click:(event)=>{ event.target._map?.panInside(event.target.getLatLng(), {paddingTopLeft:[180,420], paddingBottomRight:[180,120], animate:true}); markerRefs.current.forEach((marker) => marker.closeTooltip()); setSelected(group[0]);setSelectedFromGrid(false);setOpenPlaceKey(`${group[0].lat.toFixed(2)}:${group[0].lng.toFixed(2)}`); activeMarkerRef.current = `${group[0].lat.toFixed(2)}:${group[0].lng.toFixed(2)}`; setTimeout(() => { markerRefs.current.forEach((marker) => marker.closeTooltip()); event?.target?.openTooltip(); }, 0); setDetailPhoto(null);setFullScreenPhoto(null);setCommunityFocus(group[0]);setMapFocus(group[0]); event.target._map?.flyTo(event.target.getLatLng(), Math.max(event.target._map.getZoom(), 7), {animate:true, duration:1.1});}}}><Tooltip direction="top" offset={[0,-24]} opacity={1} autoPan={false}><div className="pinTooltip"><strong>{group[0].title}</strong><div className="pinStack">{group.slice(0,3).map((photo,index)=><img key={photo.id} src={photo.image_url} alt="" style={{zIndex:3-index}}/>)}</div>{openPlaceKey === `${group[0].lat.toFixed(2)}:${group[0].lng.toFixed(2)}` && !placeFocus && <button className="pinGalleryButton" onClick={(e)=>{e.stopPropagation();setPlaceFocus(group);setSelected(group[0]);setSelectedFromGrid(false);setCommunityFocus(group[0]);setMapFocus(group[0]);}}>Alle Bilder ansehen</button>}</div></Tooltip></Marker>)}</MapContainer></div><div className="discoverSearch"><button className="discoverSearchToggle" onClick={() => setSearchOpen((open) => !open)} aria-label="Suche">⌕ <span>Suche</span></button>{searchOpen && <div className="discoverSearchPanel"><div className="discoverSearchFields"><input value={searchUser} onChange={(e)=>setSearchUser(e.target.value)} placeholder="Nutzer oder Moment"/><input value={searchPlace} onChange={(e)=>setSearchPlace(e.target.value)} placeholder="Ort, Adresse"/><input type="date" value={searchFrom} onChange={(e)=>setSearchFrom(e.target.value)} aria-label="Von"/><input type="date" value={searchTo} onChange={(e)=>setSearchTo(e.target.value)} aria-label="Bis"/><input type="number" min="1" max="5000" value={searchRadius} onChange={(e)=>setSearchRadius(e.target.value)} placeholder="Radius in km"/></div><div className="discoverSearchMap"><MapContainer center={searchPos || [20,0]} zoom={searchPos ? 10 : 2} style={{height:"100%"}}><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Picker value={searchPos} onChange={setSearchPos}/></MapContainer></div></div>}</div><div className={`socialFilters ${gridView === "moments" ? "momentsMode" : ""}`}><div className="gridViewToggle"><button className={gridView === "photos" ? "active" : ""} onClick={() => setGridView("photos")}>Bilder</button><button className={gridView === "moments" ? "active" : ""} onClick={() => setGridView("moments")}>Momente</button></div><button className={feedFilter === "all" ? "active" : ""} onClick={() => { setFeedFilter("all"); setFeedPage(0); }}>Alle Momente</button><button className={feedFilter === "cities" ? "active" : ""} onClick={() => { setFeedFilter("cities"); setFeedPage(0); }}>Beliebte Orte</button><button className={feedFilter === "recent" ? "active" : ""} onClick={() => { setFeedFilter("recent"); setFeedPage(0); }}>Kürzlich</button><button className={feedFilter === "random" ? "active" : ""} onClick={() => { setFeedFilter("random"); setFeedPage(0); }}>Zufällig</button></div><div className={`socialGrid ${gridView === "moments" ? "viewHidden" : ""}`} id="socialGrid">{(showMine ? shuffledMine : shuffledAll).filter((photo) => feedFilter === "all" || (feedFilter === "cities" && isMajorCity(photo)) || (feedFilter === "recent" && photo.taken_at && new Date(photo.taken_at).getTime() >= Date.now() - 30 * 86400000) || feedFilter === "random").slice(feedFilter === "random" ? 0 : feedPage * 60, feedFilter === "random" ? 50 : (feedPage + 1) * 60).filter((photo) => { const text=`${photo.title} ${photo.author || ""}`.toLowerCase(); const day=photo.taken_at?.slice(0,10) || ""; return (!socialQuery || text.includes(socialQuery.toLowerCase())) && (!searchPlace || text.includes(searchPlace.toLowerCase())) && (!searchUser || text.includes(searchUser.toLowerCase())) && (!searchFrom || day >= searchFrom) && (!searchTo || day <= searchTo) && (!searchRadius || !(searchPos || communityFocus) || distance((searchPos || [communityFocus.lat, communityFocus.lng])[0], (searchPos || [communityFocus.lat, communityFocus.lng])[1], photo.lat, photo.lng) <= Number(searchRadius) * 1000) && (!mapFocus || distance(mapFocus.lat, mapFocus.lng, photo.lat, photo.lng) <= 50000) && (!placeFocus || distance(placeFocus[0].lat, placeFocus[0].lng, photo.lat, photo.lng) <= 1500) && (!mapBounds || mapBounds.contains([photo.lat, photo.lng])); }).map((photo)=><button key={photo.id} className={`socialPhoto ${selected?.id === photo.id ? "selected" : ""}`} onClick={() => { const match = groupByPlace(showMine ? myPhotos : allPhotos).find((group) => group.some((item) => item.id === photo.id)); setSelected(photo);setSelectedFromGrid(true);setCommunityFocus(null);setMapFocus(null);setPlaceFocus(null);setGridCenter(null); markerRefs.current.forEach((marker) => marker.closeTooltip()); setOpenPlaceKey(match ? `${match[0].lat.toFixed(2)}:${match[0].lng.toFixed(2)}` : null); if (match) setTimeout(() => (() => { const marker = markerRefs.current.get(`${match[0].lat.toFixed(2)}:${match[0].lng.toFixed(2)}`); if (marker) { const map = marker._map; const latLng = marker.getLatLng(); marker.openTooltip(); suppressBounds.current = true; map?.setView(latLng, map.getZoom(), {animate:true, duration:0.8}); setTimeout(() => { if (marker._map) { suppressBounds.current = true; const zoom = marker._map.getZoom(); const point = marker._map.project(latLng, zoom); const center = marker._map.unproject([point.x, point.y - marker._map.getSize().y * 0.1], zoom); marker._map.setView(center, zoom, {animate:true, duration:0.9}); } }, 420); } })(), 0); setTimeout(() => setGridCenter(photo), 30); setTimeout(() => { suppressBounds.current = false; }, 1400); setDetailPhoto(null);setFullScreenPhoto(null);}}><img src={photo.image_url} alt={photo.title}/><span>⌖ {photo.title}</span><small>{new Date(photo.taken_at).toLocaleDateString("de-DE")} · ♡ 0</small>{selected?.id === photo.id && selectedFromGrid && !placeFocus && <span className="gridGalleryButton" onClick={(e)=>{e.stopPropagation(); setPlaceFocus(groupByPlace(showMine ? myPhotos : allPhotos).find((group)=>group.some((item)=>item.id===photo.id)) || [photo]); setCommunityFocus(photo); setMapFocus(photo);}}>Alle Bilder ansehen</span>}</button>)}</div><div className={`momentList ${gridView === "moments" ? "" : "viewHidden"}`}>{groupByPlace(showMine ? myPhotos : allPhotos).map((group) => <article className="momentRow" key={`${group[0].lat}:${group[0].lng}`}><div className="momentStack">{group.slice(0,5).map((photo)=><img key={photo.id} src={photo.image_url} alt=""/>)}</div><div><h3>{group[0].title}</h3><p>{group.length} Momente an diesem Ort</p><button onClick={() => { setSelected(group[0]); setSelectedFromGrid(false); setCommunityFocus(group[0]); }}>Profil von {group[0].author || "Community"}</button></div></article>)}</div><div className="socialPagination"><button disabled={feedPage === 0} onClick={() => setFeedPage((page) => Math.max(0, page - 1))}>← Zurück</button><span>Seite {feedPage + 1}</span><button disabled={feedFilter === "random" || (showMine ? shuffledMine : shuffledAll).length <= (feedPage + 1) * 60} onClick={() => setFeedPage((page) => page + 1)}>Weiter →</button></div></div><aside className="socialDetail">{selected && (() => { const p=selected; return <><img className="detailImage" src={p.image_url} alt={p.title} onClick={() => setFullScreenPhoto(p)}/><div className="detailBody"><div className="detailTopline"><div className="eyebrow">MOMENT</div></div><h2>{p.title}</h2><p>Ein besonderer Moment aus der Community.</p><div className="detailActions"><button className={likedIds.includes(p.id) ? "liked" : ""} onClick={() => setLikedIds((ids) => ids.includes(p.id) ? ids.filter((id) => id !== p.id) : [...ids, p.id])}>♥ {likedIds.includes(p.id) ? 1 : 0} Likes</button><button onClick={() => document.getElementById("comment-box")?.focus()}>♡ Kommentieren</button></div><button className="detailAuthor" onClick={() => { setActiveNav("profile"); setShowMine(p.author === profile?.username || !p.author); document.getElementById("profile")?.scrollIntoView({behavior:"smooth"}); }}>{p.author_avatar_url ? <img className="detailAuthorAvatar" src={p.author_avatar_url} alt=""/> : <span className="detailAuthorAvatar">{(p.author || "C").slice(0,1).toUpperCase()}</span>}<span><strong>{p.author || "Community"}</strong><small>Profil ansehen · 0 Follower</small></span></button> {selectedFromGrid && !placeFocus && <button className="detailGalleryButton" onClick={()=>{ const group=groupByPlace(showMine ? myPhotos : allPhotos).find((items)=>items.some((item)=>item.id===p.id)) || [p]; setPlaceFocus(group); setCommunityFocus(p); setMapFocus(p); }}>Alle Bilder ansehen</button>}{p.user_id === user?.id && <div className="ownMomentActions"><button onClick={() => { const next = window.prompt("Titel bearbeiten", p.title || ""); if (next?.trim()) { setAllPhotos((items) => items.map((item) => item.id === p.id ? {...item, title: next.trim()} : item)); setSelected((item) => item ? {...item, title: next.trim()} : item); } }}>Bearbeiten</button><button onClick={() => { if (window.confirm("Diesen Moment wirklich löschen?")) { setAllPhotos((items) => items.filter((item) => item.id !== p.id)); setMyPhotos((items) => items.filter((item) => item.id !== p.id)); setSelected(null); setNotice("Moment gelöscht."); } }}>Löschen</button></div>}<div className="detailMapMini"><MapContainer key={`detail-map-${p.id}`} center={[p.lat,p.lng]} zoom={12} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} attributionControl={false} style={{height:"100%",width:"100%"}}><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Marker position={[p.lat,p.lng]} icon={pin}/></MapContainer></div><h3>Kommentare</h3>{comments.map((comment, i) => <p className="inlineComment" key={i}><strong>Du</strong> {comment}</p>)}<div className="commentComposer"><textarea id="comment-box" value={commentText} onChange={(e)=>setCommentText(e.target.value)} placeholder="Kommentar schreiben …" rows="3"/><button className="primary" disabled={!commentText.trim()} onClick={() => { setComments((items)=>[...items, commentText.trim()]); setCommentText(""); }}>Kommentieren</button></div></div></>})()}</aside></section>}
      {user && searchOpen && <div className="searchOverlay" onClick={() => setSearchOpen(false)}><div className="searchModal" onClick={(e)=>e.stopPropagation()}><button className="searchClose" onClick={()=>setSearchOpen(false)}>×</button><div className="eyebrow">SUCHE</div><h2>Finde Momente.</h2><input value={socialQuery} onChange={(e)=>setSocialQuery(e.target.value)} placeholder="Freier Suchbegriff"/><PlaceSearch onSelect={(place) => { setSearchPlace(place.label); setSearchPos(place.position); setCommunityFocus({lat:place.position[0],lng:place.position[1]}); }} /><div className="searchPlaceMap"><MapContainer center={searchPos || [20,0]} zoom={searchPos ? 10 : 2} style={{height:"100%"}}><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Picker value={searchPos} onChange={(pos) => { setSearchPos(pos); setSearchPlace(`${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}`); }}/></MapContainer></div><input value={searchPlace} onChange={(e)=>setSearchPlace(e.target.value)} placeholder="Ort eingeben oder oben auswählen"/><div className="searchDates"><input type="date" value={searchFrom} onChange={(e)=>setSearchFrom(e.target.value)}/><input type="date" value={searchTo} onChange={(e)=>setSearchTo(e.target.value)}/></div><input type="number" min="1" max="5000" value={searchRadius} onChange={(e)=>setSearchRadius(e.target.value)} placeholder="Radius in km"/><input value={searchUser} onChange={(e)=>setSearchUser(e.target.value)} placeholder="Nutzer"/><button className="primary full" onClick={()=>setSearchOpen(false)}>Suche anwenden</button></div></div>}
      <section className={`hero ${user ? "publicOnly" : ""}`}>
        <div className="heroCopy">
          <div className="eyebrow">DIE WELT DURCH ANDERE AUGEN</div>
          <h1>
            Ein Ort.
            <br />
            <em>Tausend Perspektiven.</em>
          </h1>
          <p>
            Entdecke Fotos von Menschen, die am gleichen Tag am gleichen Ort
            waren wie du. Jeder Moment erzählt mehr als eine Geschichte.
          </p>
          <div className="heroActions">
            <a className="primary" href="#explore">
              <Search size={17} /> Momente entdecken
            </a>
            <button className="secondary" onClick={() => { setAuthMode("signup"); setAuthOpen(true); }}>
              Jetzt registrieren
            </button>
          </div>
        </div>
        <div className="photoStack" aria-hidden="true">
          {[
            ["photo-1464822759023-fed622ff2c3b", "mountains"],
            ["photo-1518837695005-2083093ee35b", "ocean"],
            ["photo-1501785888041-af3ef285b470", "lake"],
            ["photo-1516483638261-f4dbaf036963", "coast"],
            ["photo-1476514525535-07fb3b4ae5f1", "alps"],
            ["photo-1502602898657-3e91760cbb34", "paris"],
          ].map(([photo, name], index) => (
            <figure className={`stackPhoto stackPhoto${index + 1}`} key={name}>
              <img
                src={`https://images.unsplash.com/${photo}?auto=format&fit=crop&w=650&q=80`}
                alt=""
                decoding="async"
              />
            </figure>
          ))}
          <span className="stackNote">Ein Tag. Alle Perspektiven.</span>
        </div>
        <div className="heroStats">
          <span>
            <strong>01</strong> Ort auswählen
          </span>
          <span>
            <strong>02</strong> Tag auswählen
          </span>
          <span>
            <strong>03</strong> Perspektiven entdecken
          </span>
        </div>
      </section>

      {!user && <section className="publicExplore" id="explore">
        <div className="publicExploreHead">
          <div className="publicExploreIntro"><div className="eyebrow">ENTDECKEN</div><h2>Momente aus aller Welt</h2><p>Entdecke Orte und Perspektiven aus der Community.</p></div>
        </div>
        <aside className="publicSearchPanel">
          <h2><span>⌕</span> Deine Suche</h2>
          <label>Ort oder Adresse suchen</label>
          <div className="publicSearchInput publicPlaceSearch"><PlaceSearch onSelect={(place) => { setSearchPlace(place.label || place.name || "Ausgewählter Ort"); setSearchPos(place.position); setCommunityFocus({lat: place.position[0], lng: place.position[1]}); setPlaceFocus(null); }}/></div>
          <small>Ortssuche: Photon · OpenStreetMap</small>
          <label>Oder auf der Karte auswählen</label>
          <p>Klicke auf die Karte, um einen Mittelpunkt für deine Suche festzulegen.</p>
          <label>Zeitraum</label>
          <div className="publicDateRange"><input type="date" value={searchFrom} onChange={(e) => setSearchFrom(e.target.value)} aria-label="Von"/><input type="date" value={searchTo} onChange={(e) => setSearchTo(e.target.value)} aria-label="Bis"/></div>
          <label>Suchradius <b>{searchRadius || 200} km</b></label>
          <input type="range" min="1" max="500" value={searchRadius || 200} onChange={(e) => setSearchRadius(e.target.value)}/>
          <div className="publicSearchHint">◎ Alle Fotos des ausgewählten Tages werden in deiner lokalen Zeitzone angezeigt.</div>
        </aside>
        <div className="publicExploreMap">
          <MapContainer center={[20, 0]} zoom={1} minZoom={1} maxZoom={18} maxBounds={[[-85, -180], [85, 180]]} maxBoundsViscosity={1} worldCopyJump={false} noWrap={true} style={{height: "100%"}}>
            <MapCameraFocus target={communityFocus}/><MapBoundsWatcher onChange={setMapBounds} onInteraction={() => setPlaceFocus(null)}/><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" noWrap={true}/>
            {groupByPlace(allPhotos).map((group) => <Marker key={group[0].id} position={[group[0].lat, group[0].lng]} icon={photoPin(group[0], group.some((photo) => photo.id === selected?.id))} eventHandlers={{click: () => { setSelected(group[0]); setCommunityFocus(group[0]); setPlaceFocus(group); setSelectedFromGrid(false); }}}><Tooltip direction="top"><div className="pinTooltip"><strong>{group[0].title}</strong><div className="pinStack">{group.slice(0, 3).map((photo) => <img key={photo.id} src={photo.image_url} alt=""/>)}</div></div></Tooltip></Marker>)}
          </MapContainer>
        </div>
        <div className="publicExploreGrid">
          {allPhotos.filter((photo) => (!mapBounds || mapBounds.contains([photo.lat, photo.lng])) && (!placeFocus || distance(placeFocus[0].lat, placeFocus[0].lng, photo.lat, photo.lng) <= 50000)).slice(feedPage * 30, (feedPage + 1) * 30).map((photo) => <article key={photo.id} className={selected?.id === photo.id ? "selected" : ""} onClick={() => { setSelected(photo); setSelectedFromGrid(true); setCommunityFocus(photo); }}><img src={photo.image_url} alt={photo.title}/><strong>{photo.title}</strong><span>{photo.author || "Community"}</span></article>)}
        </div>
        <div className="publicPagination"><button disabled={feedPage === 0} onClick={() => setFeedPage((page) => Math.max(0, page - 1))}>← Zurück</button><span>Seite {feedPage + 1}</span><button disabled={allPhotos.length <= (feedPage + 1) * 30} onClick={() => setFeedPage((page) => page + 1)}>Weiter →</button></div>
        {selected && <aside className="publicDetail socialDetail"><img className="detailImage" src={selected.image_url} alt={selected.title} onClick={() => setFullScreenPhoto(selected)}/><div className="detailBody"><div className="eyebrow">MOMENT</div><h2>{selected.title}</h2><p>{selected.description || "Ein besonderer Moment aus der Community."}</p><div className="detailActions"><button className={likedIds.includes(selected.id) ? "liked" : ""} onClick={() => setLikedIds((ids) => ids.includes(selected.id) ? ids.filter((id) => id !== selected.id) : [...ids, selected.id])}>♥ {likedIds.includes(selected.id) ? 1 : 0} Likes</button><button>♡ Kommentieren</button></div><button className="detailAuthor" onClick={() => setAuthOpen(true)}><span className="detailAuthorAvatar">{(selected.author || "C").slice(0, 1).toUpperCase()}</span><span><strong>{selected.author || "Community"}</strong><small>Profil ansehen · 0 Follower</small></span></button><div className="detailMapMini"><MapContainer key={`public-detail-map-${selected.id}`} center={[selected.lat, selected.lng]} zoom={12} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} attributionControl={false} style={{height: "100%", width: "100%"}}><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Marker position={[selected.lat, selected.lng]} icon={pin}/></MapContainer></div></div></aside>}
      </section>}

      {!db && (
        <p className="authPanel">
          Demo-Modus: Für Anmeldung und Upload bitte Supabase verbinden.
        </p>
      )}

      {user && (
        <section className="profilePanel" id="profile">
          <div className="dashboardHero">
            <div className="profileIdentity">{profile?.avatar_url ? <img src={profile.avatar_url} alt="Profilbild" /> : <div className="avatarFallback large">{(profile?.username || username || "S").slice(0,1).toUpperCase()}</div>}<div>
              <div className="eyebrow">DEIN PROFIL</div>
              <h1>
                {profile?.username
                  ? `Hey ${profile.username}`
                  : "Hey, willkommen"}
              </h1>
              <p>{myPhotos.length} eigene Momente · deine Perspektiven an einem Ort.</p>
              <div className="profileStats"><span><strong>{myPhotos.length}</strong> Momente</span><span><strong>0</strong> Folgen</span><span><strong>0</strong> Follower</span></div>
            </div></div>
            <button className="profileEditToggle" onClick={() => setEditingProfile((v) => !v)}>{editingProfile ? "Bearbeitung schließen" : "Profil bearbeiten"}</button>
          </div>
          <div className="profileCarousel">
            {(myPhotos.length ? myPhotos : demo).slice(0, 6).map((photo, i) => <button key={photo.id} className={`carouselCard ${i === carouselIndex ? "active" : ""}`} onClick={() => { setCarouselIndex(i); setProfileFocus(photo); }}><img src={photo.image_url} alt={photo.title}/><span>{photo.title}</span></button>)}
            {!myPhotos.length && <div className="carouselEmpty">Deine ersten Bilder warten hier.</div>}
          </div>
          {editingProfile && <div className="profileForm">
            <div className="avatarEditor">{profile?.avatar_url ? <img src={profile.avatar_url} alt="Profilbild" /> : <div className="avatarFallback">{(profile?.username || username || "S").slice(0,1).toUpperCase()}</div>}<label className="avatarUpload">{avatarBusy ? "Lädt …" : "Profilbild ändern"}<input type="file" accept="image/*" hidden disabled={avatarBusy} onChange={async (e) => { const f=e.target.files?.[0]; if (!f || !user) return; setAvatarBusy(true); try { const blob = await prepareImage(f); const url=await uploadAvatar(user.id, blob.blob); setProfile((p)=>({...p, avatar_url:url})); setNotice("Profilbild aktualisiert."); } catch(err) { setNotice(err.message); } finally { setAvatarBusy(false); e.target.value=""; } }} /></label></div>
            <input
              aria-label="Username"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              aria-label="Anzeigename"
              placeholder="Anzeigename"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button
              className="primary"
              disabled={profileBusy}
              onClick={updateProfile}
            >
              {profileBusy ? "Speichert …" : "Profil speichern"}
            </button>
          </div>}
          {myPhotos.length > 0 && (
            <div className={`profileMap ${activeMap === "profile" ? "mapActive" : ""}`} onClick={() => setActiveMap("profile")}>
              <MapContainer scrollWheelZoom={activeMap === "profile"} dragging={activeMap === "profile"}
                center={[(profileFocus || myPhotos[0]).lat, (profileFocus || myPhotos[0]).lng]}
                zoom={3}
                style={{ height: "100%" }}
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {myPhotos.map((photo) => (
                  <Marker
                    key={photo.id}
                    position={[photo.lat, photo.lng]}
                    icon={pin}
                  >
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
          {myPhotos.length > 0 && (
            <div className="profileGallery">
              {myPhotos.map((photo) => (
                <article key={photo.id} onClick={() => setDetailPhoto(photo)}>
                  <img src={photo.image_url} alt={photo.title} />
                  <strong>{photo.title}</strong>
                  <span>
                    {new Date(photo.taken_at).toLocaleDateString("de-DE")}
                  </span>
                </article>
              ))}
            </div>
          )}
          {myPhotos.length === 0 && <div className="firstUpload"><p>Noch keine eigenen Momente.</p><button className="secondary" onClick={openUpload}>Ersten Moment hinzufügen</button></div>}
          {recommendations.length > 0 && <div className="recommendFeed" id="recommend-feed"><div className="eyebrow">FÜR DICH</div><h2>Menschen, die ähnliche Momente teilen.</h2><div className="highlightRow">{recommendations.slice(0,6).map((photo)=><button key={photo.id} onClick={()=>setDetailPhoto(photo)}><img src={photo.image_url} alt={photo.title}/><strong>{photo.title}</strong><span>Empfohlen in deiner Nähe</span></button>)}</div></div>}
          <div className="communityDashboard">
            <div className="eyebrow">ENTDECKE</div><h2>Perspektiven der Community.</h2>
            <div className="highlightRow">{(photos.length ? photos : demo).slice(0, 5).map((photo) => <button key={photo.id} onClick={() => { setDetailPhoto(photo); setCommunityFocus(photo); }}><img src={photo.image_url} alt={photo.title}/><strong>{photo.title}</strong></button>)}</div>
            <div className={`communityMap ${activeMap === "community" ? "mapActive" : ""}`} onClick={() => setActiveMap("community")}><MapContainer scrollWheelZoom={activeMap === "community"} dragging={activeMap === "community"} center={communityFocus ? [communityFocus.lat, communityFocus.lng] : [20, 0]} zoom={2} style={{height:"100%"}}><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{photos.map((photo)=><Marker key={photo.id} position={[photo.lat,photo.lng]} icon={pin}></Marker>)}</MapContainer></div>
          </div>
        </section>
      )}

      <section id="how" className="how">
        <div className="howIntro">
          <div className="howIntroCopy">
            <div className="eyebrow">SO FUNKTIONIERT'S</div>
            <h2>Ein Ort. Ein Tag. Viele Blickwinkel.</h2>
            <p>Manchmal steht man am selben Ort und erlebt doch etwas völlig Eigenes. Teile deinen Moment – und entdecke, wie andere diesen Tag gesehen haben.</p>
          </div>
        </div>
        <div className="steps">
          <article className="howStep">
            <div className="stepVisual"><img src="https://images.unsplash.com/photo-1530789253388-582c481c54b0?auto=format&fit=crop&w=900&q=85" alt="Reisefoto wird vorbereitet"/></div>
            <div className="stepNumber">01</div><Upload />
            <h3>Deinen Moment hinzufügen</h3>
            <p>Wähle ein oder mehrere Bilder aus deiner Fotobibliothek. Du gibst einen Ort und den Aufnahmetag an – wir bereiten die Bilder für die Community passend auf.</p>
          </article>
          <article className="howStep">
            <div className="stepVisual"><img src="https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=900&q=85" alt="Karte mit Reiseort"/></div>
            <div className="stepNumber">02</div><MapPin />
            <h3>Den Ort auf der Karte finden</h3>
            <p>Suche nach einer Stadt, Adresse oder setze den Pin direkt auf der Karte. So wird dein Bild Teil eines Ortes, den andere aus neuen Perspektiven erkunden können.</p>
          </article>
          <article className="howStep">
            <div className="stepVisual"><img src="https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&w=900&q=85" alt="Menschen teilen Reiseerinnerungen"/></div>
            <div className="stepNumber">03</div><CalendarDays />
            <h3>Perspektiven miteinander teilen</h3>
            <p>Sieh dir Bilder anderer Menschen am gleichen Ort und rund um denselben Tag an. Folge spannenden Profilen und entdecke Geschichten, die sonst verborgen geblieben wären.</p>
          </article>
        </div>
        <div className="howNote"><span>✦</span><p><strong>Same Moment lebt von Perspektiven.</strong> Jeder Upload hilft dabei, einen Ort ein wenig vollständiger zu erzählen.</p></div>
      </section>

      {!user && <section className="appCta" aria-labelledby="app-cta-title">
        <div className="appCtaCopy"><div className="eyebrow">SAME MOMENT COMMUNITY</div><h2 id="app-cta-title">Jetzt kostenlos registrieren.<br/>Der Community beitreten.</h2><p>Teile deine Perspektive, folge Menschen mit ähnlichem Blick auf die Welt und entdecke Momente, die an einem Ort entstanden sind – auf dem Desktop und bald auch unterwegs.</p><div className="appCtaActions"><button className="primary" onClick={() => { setAuthMode("signup"); setAuthOpen(true); }}>Jetzt Konto erstellen</button><a className="appStoreBadge" href="https://www.apple.com/de/app-store/" target="_blank" rel="noreferrer"><span className="appleMark">●</span><span><small>Demnächst im</small><strong>App Store</strong></span></a></div><div className="qrInvite"><div className="qrPreview" aria-label="Vorschau eines App-Store QR-Codes">{[1,0,1,1,0,1,0,1,1,0,1,0,1,0,1,1,0,1,1,0,1,1,0,1,0,1,1,0,1,1,0,1,0,1,0,1,1,1,0,1,0,1,1,0,1,0,1,1,0].map((cell, index) => <i className={cell ? "on" : ""} key={index}/>)}</div><span><strong>iOS-App in Vorbereitung</strong><small>Der QR-Code führt mit Veröffentlichung direkt in den App Store.</small></span></div></div>
        <div className="appMockup" aria-label="Vorschau der iOS-App"><div className="phoneFrame"><div className="phoneDynamicIsland"><i/><b/></div><div className="phoneScreen"><div className="phoneTop"><strong>same<br/><b>moment</b></strong><span>⌕</span></div><img className="phoneHero" src={shuffledAll[0]?.image_url} alt="Vorschau eines Community-Moments"/><div className="phoneMoment"><small>MOMENT IN DER NÄHE</small><strong>{shuffledAll[0]?.title || "Dein nächster Moment"}</strong><span>♡ Entdecken · ⌖ Karte</span></div><div className="phoneThumbs">{shuffledAll.slice(1,4).map((photo) => <img src={photo.image_url} alt="" key={photo.id}/>)}</div><div className="phoneNav"><span>⌖</span><span>▦</span><span className="phoneAdd">＋</span><span>♡</span><span>◉</span></div></div></div><span className="appOrbit orbitOne"/><span className="appOrbit orbitTwo"/></div>
      </section>}

      {!user && <section className="highlights" aria-labelledby="highlights-title">
        <div className="highlightsHead">
          <div className="highlightsIntro"><div className="eyebrow">AUS DER COMMUNITY</div><h2 id="highlights-title">Highlights, die im Kopf bleiben.</h2><p>Ein kleiner Ausschnitt aus den Momenten, die gerade auf Same Moment geteilt werden.</p></div>
        </div>
        <div className="highlightsSliderWrap">
        <div className="highlightsSlider">
          {shuffledAll.slice(0, 10).map((photo, index) => <button className="highlightCard" key={photo.id} onClick={() => setFullScreenPhoto(photo)}>
            <img src={photo.image_url} alt={photo.title}/><span className="highlightIndex">{String(index + 1).padStart(2, "0")}</span><span className="highlightCaption"><strong>{photo.title}</strong><small>{photo.author || "Community"}</small></span>
          </button>)}
        </div>
        </div>
      </section>}
      <footer>
        © {new Date().getFullYear()} SameMoment · Ein Ort. Tausend
        Perspektiven.
        <span className="footerLinks"><button onClick={() => { setLegalPage("impressum"); window.location.hash = "impressum"; }}>Impressum</button><button onClick={() => { setLegalPage("datenschutz"); window.location.hash = "datenschutz"; }}>Datenschutz</button><button onClick={() => { setLegalPage("agb"); window.location.hash = "agb"; }}>AGB</button><button onClick={() => { setLegalPage("kontakt"); window.location.hash = "kontakt"; }}>Kontakt</button></span>
      </footer>
      <LegalPages page={legalPage} onClose={() => { setLegalPage(null); window.history.replaceState(null, "", window.location.pathname + window.location.search); }}/>
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice("")}>
          {notice} ×
        </div>
      )}
      {fullScreenPhoto && (() => { const gallery = showMine ? shuffledMine : shuffledAll; const index = Math.max(0, gallery.findIndex((item) => item.id === fullScreenPhoto.id)); const move = (step) => { const next = gallery[(index + step + gallery.length) % gallery.length]; if (next) { setFullScreenPhoto(next); setSelected(next); } }; return <div className="overlay fullImageOverlay" onClick={() => setFullScreenPhoto(null)}><button className="close fullImageClose" onClick={() => setFullScreenPhoto(null)}><X /></button><button className="fullImageArrow left" onClick={(e) => { e.stopPropagation(); move(-1); }}>‹</button><img className="fullImage" src={fullScreenPhoto.image_url} alt={fullScreenPhoto.title} onClick={(e) => e.stopPropagation()}/><button className="fullImageArrow right" onClick={(e) => { e.stopPropagation(); move(1); }}>›</button></div>; })()}
      {user && <nav className="bottomNav" aria-label="Hauptnavigation"><button className={activeTab === "profile" ? "active" : ""} onClick={() => { setActiveTab("profile"); document.getElementById("profile")?.scrollIntoView({behavior:"smooth"}); }}>Dein Profil</button><button className={activeTab === "following" ? "active" : ""} onClick={() => { setActiveTab("following"); document.getElementById("recommend-feed")?.scrollIntoView({behavior:"smooth"}); }}>Von dir gefolgt</button><button className={activeTab === "explore" ? "active" : ""} onClick={() => { setActiveTab("explore"); document.getElementById("explore")?.scrollIntoView({behavior:"smooth"}); }}>Entdecken</button><button className="navUpload" onClick={openUpload}><Upload size={16}/> Bilder hinzufügen</button></nav>}
      {authOpen && <div className="overlay" onClick={() => setAuthOpen(false)}><div className="modal authModal" onClick={(e) => e.stopPropagation()}><button className="close" onClick={() => setAuthOpen(false)}><X /></button><div className="eyebrow">SAME MOMENT KONTO</div><h2>{authMode === "signup" ? "Konto erstellen." : "Willkommen zurück."}</h2><p>Du brauchst ein Konto, um Fotos zu veröffentlichen.</p><input type="email" placeholder="E-Mail-Adresse" value={email} onChange={(e) => setEmail(e.target.value)} />{authMode === "signup" && <input type="text" placeholder="Nutzername (3–24 Zeichen)" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24))} autoComplete="username" />}<input type="password" placeholder="Passwort (mindestens 8 Zeichen)" value={password} onChange={(e) => setPassword(e.target.value)} />{authMode === "signup" && <label className="consent"><input type="checkbox" checked={accountConsent} onChange={(e) => setAccountConsent(e.target.checked)} /><span>Ich akzeptiere die <a href="#agb">Nutzungsbedingungen</a> und <a href="#agb">Community-Regeln</a>. Ich lade nur Inhalte hoch, die ich veröffentlichen darf.</span></label>}<button className="primary full" disabled={authBusy} onClick={login}>{authBusy ? "Bitte warten …" : authMode === "signup" ? "Konto erstellen" : "Anmelden"}</button><button className="authSwitch" onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setNotice(""); }}>{authMode === "signup" ? "Ich habe bereits ein Konto" : "Neues Konto erstellen"}</button>{confirmationPending && <button className="authSwitch" onClick={resendConfirmation}>Bestätigungs-E-Mail erneut senden</button>}</div></div>}
      {modal && (
        <div className="overlay uploadScreen" onClick={() => setModal(false)}>
          <div className="modal uploadPage" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">DEIN MOMENT</div>
            <h2>Füge einen neuen Moment hinzu</h2>
            <p>Teile diesen Ort und deine Perspektive mit anderen.</p>
            <label className="drop">
              {preview ? (
                <img src={preview} alt="Vorschau des optimierten Fotos" />
              ) : (
                <>
                  <Upload size={30} />
                  <strong>
                    {preparing ? "Foto wird optimiert …" : "Foto auswählen"}
                  </strong>
                  <span>JPG, PNG, HEIC, WebP, AVIF, GIF, BMP und TIFF</span>
                </>
              )}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  choose(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="hint" role="status">
              {preparing
                ? "Dein Foto wird automatisch umgewandelt und verkleinert …"
                : imageInfo
                  ? `Bereit: ${imageInfo.count || 1} Bild${(imageInfo.count || 1) === 1 ? "" : "er"} · ${imageInfo.width} × ${imageInfo.height} px. Automatisch optimiert.`
                  : "Mehrere Bilder auswählen: Ort und Aufnahmetag gelten für alle. Format und Dateigröße passen wir automatisch an."}
            </p>
            <label>Titel</label>
            <input
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ein unvergesslicher Moment"
            />
            <label>Aufnahmetag</label>
            <input
              type="date"
              value={taken.slice(0, 10)}
              onChange={(e) => setTaken(cameraDate(e.target.value))}
            />
            <label>Aufnahmeort (auf der Karte markieren)</label>
            <PlaceSearch onSelect={(place) => setPos(place.position)} />
            <div className="pickmap">
              <MapContainer
                center={pos || [50, 10]}
                zoom={pos ? 11 : 3}
                key={pos ? "located" : "world"}
                style={{ height: "100%" }}
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Picker value={pos} onChange={setPos} />
              </MapContainer>
            </div>
            <p className="hint">
              {pos
                ? `GPS: ${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}`
                : "Kein GPS erkannt? Klicke auf den richtigen Ort."}
            </p>
            <p className="hint">
              Mit der Veröffentlichung werden Bild, Standort und Aufnahmetag
              öffentlich sichtbar. Lade nur Bilder hoch, an denen du die Rechte
              hast.
            </p>
            <label className="consent"><input type="checkbox" checked={uploadConsent} onChange={(e) => setUploadConsent(e.target.checked)} /><span>Ich habe die Rechte an diesem Bild und stimme der öffentlichen Veröffentlichung von Bild, Standort und Aufnahmetag zu.</span></label>
            <label className="consent"><input type="checkbox" checked={safeContentConsent} onChange={(e) => setSafeContentConsent(e.target.checked)} /><span>Ich bestätige, dass das Bild keine rechtswidrigen, gewaltverherrlichenden, pornografischen, diskriminierenden oder anderweitig schädlichen Inhalte enthält.</span></label>
            <button
              className="primary full"
              disabled={busy || preparing || !uploadConsent || !safeContentConsent}
              onClick={upload}
            >
              {busy ? "Wird hochgeladen …" : batchFiles.length > 1 ? `${batchFiles.length} Fotos veröffentlichen` : "Foto öffentlich veröffentlichen"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
