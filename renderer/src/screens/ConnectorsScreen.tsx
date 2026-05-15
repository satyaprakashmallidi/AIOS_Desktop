import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Box,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CheckSquare,
  Cloud,
  CreditCard,
  Database,
  ExternalLink,
  Facebook,
  FileSpreadsheet,
  FileText,
  Film,
  Github,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Inbox,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  Palette,
  Phone,
  PhoneCall,
  Plug,
  Plus,
  Search,
  Send,
  Sheet,
  Shield,
  Table,
  Twitter,
  Video,
  X,
  Youtube
} from "lucide-react";
import { relay, RELAY_AVAILABLE, RelayError, type RelayConnection } from "../lib/aios-relay";
import { invoke, newId } from "../lib/api";
import type { ClaudeStatus } from "../types";

type ConnectorStatus = "connected" | "not_connected" | "connecting" | "error" | "expired" | "stalled";

interface Connector {
  service: string;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number }>;
  logoUrl?: string;
  comingSoon?: boolean;
  // Most connectors authorize via Composio OAuth through the relay; a small
  // number (currently just WhatsApp Personal via Baileys) auth locally on the
  // device. The flag tells `connect()` to skip the OAuth path and run the
  // local flow instead — for baileys-qr, that means opening a QR-pairing modal
  // backed by the whatsapp_start / whatsapp_stop IPC commands.
  localAuth?: "baileys-qr";
}

// Format a raw WhatsApp phone number (digits only, e.g. "917013252723") into
// a readable display string like "+91 70132 52723". Falls back to a +<digits>
// prefix when the country-code split isn't obvious.
function formatPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

const CONNECTOR_CATALOG: Connector[] = [
  {
    service: "gmail",
    label: "Gmail",
    description: "Read your inbox, draft replies, find threads, send mail.",
    Icon: Mail,
    logoUrl: "https://api.iconify.design/logos:google-gmail.svg"
  },
  {
    service: "google-calendar",
    label: "Google Calendar",
    description: "See your schedule, find free slots, create events.",
    Icon: Calendar,
    logoUrl: "https://api.iconify.design/logos:google-calendar.svg"
  },
  {
    service: "slack",
    label: "Slack",
    description: "Read channels, post messages, search conversations.",
    Icon: MessageSquare,
    logoUrl: "https://api.iconify.design/logos:slack-icon.svg"
  },
  {
    service: "clickup",
    label: "ClickUp",
    description: "Create tasks, update statuses, query lists.",
    Icon: CheckSquare,
    logoUrl: "https://svgl.app/library/clickup.svg"
  },
  {
    service: "notion",
    label: "Notion",
    description: "Read pages, search databases, append blocks.",
    Icon: FileText,
    logoUrl: "https://api.iconify.design/logos:notion.svg"
  },
  {
    service: "github",
    label: "GitHub",
    description: "Browse repos, read issues, open PRs.",
    Icon: Github,
    logoUrl: "https://api.iconify.design/logos:github-icon.svg"
  },
  {
    service: "stripe",
    label: "Stripe",
    description: "Payments, subscriptions, customers, charges, MRR.",
    Icon: CreditCard,
    logoUrl: "https://api.iconify.design/logos:stripe.svg"
  },
  {
    service: "youtube",
    label: "YouTube",
    description: "Channel stats, video performance, subscriber growth.",
    Icon: Youtube,
    logoUrl: "https://api.iconify.design/logos:youtube-icon.svg"
  },
  {
    service: "google-analytics",
    label: "Google Analytics",
    description: "Site traffic, conversion, audience metrics from GA4.",
    Icon: BarChart3,
    logoUrl: "https://api.iconify.design/logos:google-analytics.svg"
  },
  {
    service: "google-sheets",
    label: "Google Sheets",
    description: "Read structured data from sheets you own.",
    Icon: Sheet,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ae/Google_Sheets_2020_Logo.svg"
  },
  // Communication / social connectors (v0.1.11+)
  {
    service: "outlook",
    label: "Outlook",
    description: "Read mail, draft replies, search threads, manage your inbox.",
    Icon: Inbox,
    logoUrl: "https://api.iconify.design/vscode-icons:file-type-outlook.svg"
  },
  {
    service: "linkedin",
    label: "LinkedIn",
    description: "Read your profile, post updates, browse connections.",
    Icon: Linkedin,
    logoUrl: "https://api.iconify.design/logos:linkedin-icon.svg"
  },
  {
    service: "whatsapp",
    label: "WhatsApp Business",
    description: "Send WhatsApp Business messages, manage templates, read profile.",
    Icon: MessageCircle,
    logoUrl: "https://api.iconify.design/logos:whatsapp-icon.svg"
  },
  {
    service: "whatsapp-personal",
    label: "WhatsApp Personal",
    description: "Link your own WhatsApp number to chat with AIOS from your phone.",
    Icon: MessageCircle,
    logoUrl: "https://api.iconify.design/logos:whatsapp-icon.svg",
    localAuth: "baileys-qr"
  },
  {
    service: "twitter",
    label: "X",
    description: "Read your timeline, post tweets, search, manage DMs.",
    Icon: Twitter,
    logoUrl: "https://api.iconify.design/simple-icons:x.svg"
  },
  {
    service: "telegram",
    label: "Telegram",
    description: "Send and read bot messages, manage chats, broadcast updates.",
    Icon: Send,
    logoUrl: "https://api.iconify.design/logos:telegram.svg"
  },
  {
    service: "facebook",
    label: "Facebook",
    description: "Manage Pages, read posts and insights, browse conversations.",
    Icon: Facebook,
    logoUrl: "https://api.iconify.design/logos:facebook.svg"
  },
  {
    service: "instagram",
    label: "Instagram",
    description: "Read profile, browse media, surface insights for your account.",
    Icon: Camera,
    logoUrl: "https://api.iconify.design/logos:instagram-icon.svg"
  },
  // Productivity, storage, design, dev, voice — v0.1.26 connectors expansion
  {
    service: "supabase",
    label: "Supabase",
    description: "Run SQL, deploy edge functions, manage projects.",
    Icon: Database,
    logoUrl: "https://api.iconify.design/logos:supabase-icon.svg"
  },
  {
    service: "google-drive",
    label: "Google Drive",
    description: "Find files, upload outputs, share folders, manage permissions.",
    Icon: HardDrive,
    logoUrl: "https://api.iconify.design/logos:google-drive.svg"
  },
  {
    service: "airtable",
    label: "Airtable",
    description: "Read and update records across your bases.",
    Icon: Table,
    logoUrl: "https://api.iconify.design/logos:airtable.svg"
  },
  {
    service: "firecrawl",
    label: "Firecrawl",
    description: "Scrape pages, crawl sites, extract structured data from the web.",
    Icon: Globe,
    logoUrl: "https://www.firecrawl.dev/favicon.ico"
  },
  {
    service: "discord",
    label: "Discord",
    description: "Read guilds, post messages, manage your servers.",
    Icon: MessageSquare,
    logoUrl: "https://api.iconify.design/logos:discord-icon.svg"
  },
  {
    service: "onedrive",
    label: "OneDrive",
    description: "Find files, upload outputs, manage folders in your OneDrive.",
    Icon: Cloud,
    logoUrl: "https://api.iconify.design/logos:microsoft-onedrive.svg"
  },
  {
    service: "exa",
    label: "Exa",
    description: "Deep web search with semantic results, contents, find-similar.",
    Icon: Search,
    logoUrl: "https://exa.ai/favicon.ico"
  },
  {
    service: "elevenlabs",
    label: "ElevenLabs",
    description: "Text-to-speech, voice cloning, conversational voice agents.",
    Icon: Mic,
    logoUrl: "https://api.iconify.design/simple-icons:elevenlabs.svg"
  },
  {
    service: "salesforce",
    label: "Salesforce",
    description: "Create accounts, contacts, opportunities, run SOQL queries.",
    Icon: Building2,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f9/Salesforce.com_logo.svg"
  },
  {
    service: "calendly",
    label: "Calendly",
    description: "List bookings, create event types, manage invitees.",
    Icon: Calendar,
    logoUrl: "https://api.iconify.design/simple-icons:calendly.svg"
  },
  {
    service: "google-meet",
    label: "Google Meet",
    description: "Create meeting spaces, fetch transcripts, list recordings.",
    Icon: Video,
    logoUrl: "https://api.iconify.design/logos:google-meet.svg"
  },
  {
    service: "zoho",
    label: "Zoho",
    description: "Manage CRM records, leads, contacts, and accounts.",
    Icon: Briefcase,
    logoUrl: "https://api.iconify.design/simple-icons:zoho.svg"
  },
  {
    service: "dropbox",
    label: "Dropbox",
    description: "Upload, find, share, and manage files in your Dropbox.",
    Icon: Cloud,
    logoUrl: "https://api.iconify.design/logos:dropbox.svg"
  },
  {
    service: "heygen",
    label: "HeyGen",
    description: "Generate avatar videos and AI voiceovers from a script.",
    Icon: Film,
    logoUrl: "https://www.heygen.com/favicon.ico"
  },
  {
    service: "yousearch",
    label: "You.com",
    description: "Quick web answers from You.com search.",
    Icon: Search,
    logoUrl: "https://you.com/favicon.ico"
  },
  {
    service: "retellai",
    label: "Retell AI",
    description: "Build voice agents, place outbound calls, manage knowledge.",
    Icon: PhoneCall
    // No reliable hosted logo for Retell AI as of v0.1.26 — the brand site
    // 403s favicon.ico requests and Retell isn't in iconify's logos /
    // simple-icons sets. Card falls back to the Lucide PhoneCall icon, which
    // reads cleanly in the sage color scheme.
  },
  {
    service: "canva",
    label: "Canva",
    description: "Create and export designs, manage your assets.",
    Icon: Palette,
    logoUrl: "https://www.canva.com/favicon.ico"
  },
  {
    service: "cal-com",
    label: "Cal.com",
    description: "List bookings, create event types, cancel and confirm.",
    Icon: CalendarDays,
    logoUrl: "https://api.iconify.design/simple-icons:caldotcom.svg"
  },
  {
    service: "telnyx",
    label: "Telnyx",
    description: "Send SMS, manage phone numbers, look up carriers.",
    Icon: Phone,
    logoUrl: "https://telnyx.com/favicon.ico"
  },
  {
    service: "cloudflare",
    label: "Cloudflare",
    description: "Manage DNS records, list zones, configure WAF.",
    Icon: Shield,
    logoUrl: "https://api.iconify.design/logos:cloudflare.svg"
  },
  {
    service: "reddit",
    label: "Reddit",
    description: "Post, comment, browse subreddits, search threads.",
    Icon: MessageCircle,
    logoUrl: "https://api.iconify.design/logos:reddit-icon.svg"
  },
  {
    service: "cloudinary",
    label: "Cloudinary",
    description: "Upload media, manage folders, transform images and video.",
    Icon: ImageIcon,
    logoUrl: "https://api.iconify.design/simple-icons:cloudinary.svg"
  },
  {
    service: "convex",
    label: "Convex",
    description: "Manage Convex projects, deployments, and functions.",
    Icon: Database,
    logoUrl: "https://api.iconify.design/simple-icons:convex.svg"
  },
  {
    service: "dockerhub",
    label: "DockerHub",
    description: "Manage repos, webhooks, organization members, image tags.",
    Icon: Box,
    logoUrl: "https://api.iconify.design/logos:docker-icon.svg"
  },
  {
    service: "excel",
    label: "Excel",
    description: "Read ranges, append rows, list tables in Excel Online.",
    Icon: FileSpreadsheet,
    logoUrl: "https://api.iconify.design/vscode-icons:file-type-excel.svg"
  },
  {
    service: "google-maps",
    label: "Google Maps",
    description: "Search places, geocode addresses, get directions.",
    Icon: MapPin,
    logoUrl: "https://api.iconify.design/logos:google-maps.svg"
  }
];

// Section-grouped rendering of CONNECTOR_CATALOG. Keeps the page navigable
// once we passed ~20 connectors — a flat 44-card grid felt random. Service
// slugs not listed here fall into "Other" so adding a new connector to the
// catalog doesn't strand it.
const CATEGORY_ORDER = [
  "Email & Calendar",
  "Messaging & Social",
  "Productivity & Docs",
  "Storage",
  "CRM",
  "Dev & Infra",
  "Analytics & Payments",
  "AI & Media",
  "Web, Search & Tools",
] as const;

type CategoryName = (typeof CATEGORY_ORDER)[number];

const CATEGORY_OF: Record<string, CategoryName> = {
  // Email & Calendar
  gmail: "Email & Calendar",
  outlook: "Email & Calendar",
  "google-calendar": "Email & Calendar",
  calendly: "Email & Calendar",
  "cal-com": "Email & Calendar",
  "google-meet": "Email & Calendar",
  // Messaging & Social
  slack: "Messaging & Social",
  discord: "Messaging & Social",
  whatsapp: "Messaging & Social",
  "whatsapp-personal": "Messaging & Social",
  telegram: "Messaging & Social",
  reddit: "Messaging & Social",
  linkedin: "Messaging & Social",
  twitter: "Messaging & Social",
  facebook: "Messaging & Social",
  instagram: "Messaging & Social",
  youtube: "Messaging & Social",
  // Productivity & Docs
  notion: "Productivity & Docs",
  clickup: "Productivity & Docs",
  airtable: "Productivity & Docs",
  "google-sheets": "Productivity & Docs",
  excel: "Productivity & Docs",
  // Storage
  "google-drive": "Storage",
  onedrive: "Storage",
  dropbox: "Storage",
  // CRM
  salesforce: "CRM",
  zoho: "CRM",
  // Dev & Infra
  github: "Dev & Infra",
  dockerhub: "Dev & Infra",
  cloudflare: "Dev & Infra",
  supabase: "Dev & Infra",
  convex: "Dev & Infra",
  // Analytics & Payments
  stripe: "Analytics & Payments",
  "google-analytics": "Analytics & Payments",
  // AI & Media
  elevenlabs: "AI & Media",
  heygen: "AI & Media",
  retellai: "AI & Media",
  cloudinary: "AI & Media",
  canva: "AI & Media",
  // Web, Search & Tools
  firecrawl: "Web, Search & Tools",
  exa: "Web, Search & Tools",
  yousearch: "Web, Search & Tools",
  "google-maps": "Web, Search & Tools",
  telnyx: "Web, Search & Tools",
};

// Within a category, connected cards rise to the top so the user sees their
// active services first, with not-yet-connected ones underneath.
const STATUS_RANK: Record<ConnectorStatus, number> = {
  connected: 0,
  connecting: 1,
  stalled: 2,
  expired: 3,
  error: 4,
  not_connected: 5,
};

// Connectors that require extra user-provided fields BEFORE OAuth can start.
// Composio surfaces these via auth_config.expected_input_fields. The renderer
// pops a small modal asking for the values and forwards them to the relay as
// `{ authScheme, val: { ...fields } }` on /initiate.
interface FieldRequirement {
  key: string;            // exact key Composio expects under state.val (e.g. "generic_id")
  label: string;          // human label shown in the modal
  placeholder: string;
  description: string;    // shown directly under the input
  helpText: string;       // longer "where do I find this?" hint at the bottom
  helpLink?: string;
  helpLinkLabel?: string; // optional override for the link's link text
  secret?: boolean;       // true → render as <input type="password">
}

const CONNECTOR_FIELD_REQUIREMENTS: Record<string, { authScheme: string; fields: FieldRequirement[] }> = {
  whatsapp: {
    authScheme: "OAUTH2",
    fields: [
      {
        key: "generic_id",
        label: "WhatsApp Business Account ID",
        placeholder: "e.g. 102553451781234",
        description: "Numeric WhatsApp Business Account (WABA) ID issued by Meta when your WhatsApp Business API was approved.",
        helpText:
          "Open Meta Business Manager → Business settings → Accounts → WhatsApp accounts. Pick your account; the WABA ID is shown at the top. " +
          "If you don't have one yet, you'll need to apply through Meta Business Suite — WhatsApp connector only supports approved WhatsApp Business accounts (not personal WhatsApp).",
        helpLink: "https://business.facebook.com/settings/whatsapp-business-accounts",
        helpLinkLabel: "Open Meta Business",
      },
    ],
  },
  telegram: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        description: "Telegram bot token issued by @BotFather when you create the bot.",
        helpText:
          "Open Telegram → search for @BotFather → send /newbot → follow the prompts to name your bot. " +
          "BotFather replies with the token in the format 'NUMBERS:LETTERS_NUMBERS' — paste exactly that here. " +
          "If you already have a bot, send /token to BotFather to retrieve it.",
        helpLink: "https://t.me/BotFather",
        helpLinkLabel: "Open BotFather in Telegram",
        secret: true,
      },
    ],
  },
  firecrawl: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Firecrawl API key",
        placeholder: "fc-...",
        description: "API key from your Firecrawl dashboard.",
        helpText: "Sign up at firecrawl.dev, then go to /app → API Keys and create a new key.",
        helpLink: "https://www.firecrawl.dev/app/api-keys",
        helpLinkLabel: "Open Firecrawl",
        secret: true,
      },
    ],
  },
  exa: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Exa API key",
        placeholder: "...",
        description: "API key from your Exa dashboard.",
        helpText: "Sign in at exa.ai → dashboard → API keys.",
        helpLink: "https://dashboard.exa.ai/",
        helpLinkLabel: "Open Exa dashboard",
        secret: true,
      },
    ],
  },
  elevenlabs: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "ElevenLabs API key",
        placeholder: "sk_...",
        description: "Personal API key from your ElevenLabs profile.",
        helpText: "Open elevenlabs.io → click your profile → 'Profile + API key' → copy the key.",
        helpLink: "https://elevenlabs.io/app/settings/api-keys",
        helpLinkLabel: "Open ElevenLabs",
        secret: true,
      },
    ],
  },
  heygen: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "HeyGen API key",
        placeholder: "...",
        description: "API key from your HeyGen developer settings.",
        helpText: "Open app.heygen.com → Space Settings → API → Create / copy your key.",
        helpLink: "https://app.heygen.com/settings?nav=API",
        helpLinkLabel: "Open HeyGen",
        secret: true,
      },
    ],
  },
  yousearch: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "You.com API key",
        placeholder: "...",
        description: "API key from your You.com developer console.",
        helpText: "Sign in at api.you.com → API Keys → create a new key.",
        helpLink: "https://api.you.com/",
        helpLinkLabel: "Open You.com API",
        secret: true,
      },
    ],
  },
  retellai: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Retell AI API key",
        placeholder: "key_...",
        description: "API key from your Retell AI dashboard.",
        helpText: "Open retellai.com → dashboard → API Keys → create one.",
        helpLink: "https://dashboard.retellai.com/apiKeys",
        helpLinkLabel: "Open Retell AI",
        secret: true,
      },
    ],
  },
  telnyx: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Telnyx API key",
        placeholder: "KEY...",
        description: "V2 API key from your Telnyx Mission Control portal.",
        helpText: "Open portal.telnyx.com → API Keys → create a new V2 key.",
        helpLink: "https://portal.telnyx.com/#/app/api-keys",
        helpLinkLabel: "Open Telnyx portal",
        secret: true,
      },
    ],
  },
  cloudflare: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Cloudflare API token",
        placeholder: "...",
        description: "Scoped API token (NOT the global API key).",
        helpText:
          "Open dash.cloudflare.com → My Profile → API Tokens → Create Token. " +
          "Use a scoped template (e.g. 'Edit zone DNS') — never paste your global key.",
        helpLink: "https://dash.cloudflare.com/profile/api-tokens",
        helpLinkLabel: "Open Cloudflare tokens",
        secret: true,
      },
    ],
  },
  cloudinary: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Cloudinary API environment URL",
        placeholder: "cloudinary://api_key:api_secret@cloud_name",
        description: "Full Cloudinary URL with key + secret + cloud name.",
        helpText: "Open cloudinary.com → Console → Dashboard → 'API environment variable' → copy the cloudinary:// string.",
        helpLink: "https://console.cloudinary.com/",
        helpLinkLabel: "Open Cloudinary",
        secret: true,
      },
    ],
  },
  convex: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "Convex deploy key",
        placeholder: "prod:...",
        description: "Project deploy key from Convex.",
        helpText: "Open dashboard.convex.dev → your project → Settings → Deploy Keys.",
        helpLink: "https://dashboard.convex.dev/",
        helpLinkLabel: "Open Convex",
        secret: true,
      },
    ],
  },
  dockerhub: {
    authScheme: "API_KEY",
    fields: [
      {
        key: "generic_api_key",
        label: "DockerHub access token",
        placeholder: "dckr_pat_...",
        description: "Personal Access Token (NOT your password).",
        helpText: "Open hub.docker.com → Account Settings → Security → New Access Token.",
        helpLink: "https://hub.docker.com/settings/security",
        helpLinkLabel: "Open DockerHub security",
        secret: true,
      },
    ],
  },
};

interface ConnectorView extends Connector {
  status: ConnectorStatus;
  accountLabel?: string;
  connectionId?: string;
  errorMessage?: string;
}

// Status of the locally-authed WhatsApp Personal worker, surfaced from the
// scanner's whatsapp_update broadcasts. mergeConnections uses it to drive the
// WhatsApp Personal card without going through the relay.
interface WhatsAppPersonalState {
  status: "disconnected" | "qr" | "authenticating" | "connected";
  phoneNumber: string | null;
}

function mergeConnections(
  catalog: Connector[],
  live: RelayConnection[],
  stalled: Set<string>,
  localLabels: Record<string, string>,
  whatsappPersonal: WhatsAppPersonalState
): ConnectorView[] {
  const byService = new Map(live.map((c) => [c.service, c]));
  return catalog.map((entry) => {
    // Locally-authed connectors (today only WhatsApp Personal via Baileys)
    // skip the relay entirely; their status comes from the device's worker.
    if (entry.localAuth === "baileys-qr") {
      let status: ConnectorStatus;
      if (whatsappPersonal.status === "connected") status = "connected";
      else if (whatsappPersonal.status === "qr" || whatsappPersonal.status === "authenticating") status = "connecting";
      else status = "not_connected";
      return {
        ...entry,
        status,
        accountLabel: whatsappPersonal.phoneNumber ? formatPhoneNumber(whatsappPersonal.phoneNumber) : undefined
      };
    }
    const found = byService.get(entry.service);
    if (!found) {
      return { ...entry, status: "not_connected" as ConnectorStatus };
    }
    let status: ConnectorStatus;
    if (found.status === "connected") status = "connected";
    else if (found.status === "expired") status = "expired";
    else if (found.status === "error") status = "error";
    else if (stalled.has(entry.service)) status = "stalled";
    else status = "connecting";
    return {
      ...entry,
      status,
      accountLabel: localLabels[entry.service] ?? found.account_label ?? undefined,
      connectionId: found.composio_connection_id
    };
  });
}

export function ConnectorsScreen({ deviceUserId, claude }: { deviceUserId: string; claude: ClaudeStatus | null }) {
  const [identifying, setIdentifying] = useState<Set<string>>(new Set());
  const [localLabels, setLocalLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const identifyAttemptedRef = useRef<Set<string>>(new Set());

  // Ask Claude to identify the connected account's email. Composio's REST API
  // redacts every identity field, but Claude (via the Composio MCP tool router)
  // can call a service-specific tool and extract the email from the result.
  //
  // SPEED: prompts pre-specify the Composio tool slug so Claude skips the
  // COMPOSIO_SEARCH_TOOLS roundtrip. Combined with model: "haiku" override,
  // identify went from ~10s to ~3-4s per service.
  async function identifyAccount(service: string) {
    if (!claude?.path || !claude.runtimeOk) return;
    if (identifyAttemptedRef.current.has(service)) return;
    identifyAttemptedRef.current.add(service);
    setIdentifying((s) => new Set(s).add(service));
    try {
      const prompts: Record<string, string> = {
        gmail: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GMAIL_FETCH_EMAILS" and arguments {"query": "in:sent", "max_results": 1}. Read the "From" header of the returned message — that address is the account owner. Reply with ONLY the bare email, nothing else. If the result has no messages, reply: UNKNOWN.`,
        "google-calendar": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLECALENDAR_LIST_CALENDARS" and arguments {}. Find the calendar where "primary" is true — its "id" is the user's email. Reply with ONLY the bare email, nothing else. If no primary calendar, reply: UNKNOWN.`,
        slack: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "SLACK_LIST_ALL_SLACK_TEAM_CHANNELS_WITH_VARIOUS_FILTERS" and arguments {"types": "public_channel", "limit": 1}. From the response, read team_id. Then call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL with tool_slug "SLACK_RETRIEVE_TEAM_PROFILE_DETAILS" and arguments {"team": team_id_from_step_1}. Reply with the team's "name" field — that's the workspace name. ONLY the workspace name, nothing else. If unsure, reply: UNKNOWN.`,
        clickup: `Reply with the single word: UNKNOWN`,
        notion: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "NOTION_GET_ABOUT_ME" and arguments {}. Find the user's email (often at bot.owner.user.person.email) or workspace name. Reply with ONLY the bare email or workspace name, nothing else. If unsure, reply: UNKNOWN.`,
        github: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GITHUB_GET_THE_AUTHENTICATED_USER" and arguments {}. Read the "email" field. If null, use "@" + the "login" field. Reply with ONLY the bare email or @login, nothing else. If unsure, reply: UNKNOWN.`,
        stripe: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "STRIPE_RETRIEVE_BALANCE" and arguments {}. Read available[0].currency (uppercased). Reply with "Stripe (CURRENCY)" — e.g. "Stripe (USD)". ONLY that, nothing else. If unsure, reply: UNKNOWN.`,
        youtube: `Reply with the single word: UNKNOWN`,
        "google-analytics": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLE_ANALYTICS_LIST_ACCOUNTS" and arguments {}. Find the first account's "displayName". Reply with ONLY that name, nothing else. If no accounts, reply: UNKNOWN.`,
        "google-sheets": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLESHEETS_SEARCH_SPREADSHEETS" and arguments {"query": "", "page_size": 1}. Find the owner's emailAddress in the first result's "owners[0].emailAddress" field. Reply with ONLY that bare email, nothing else. If unsure, reply: UNKNOWN.`,
        outlook: `Reply with the single word: UNKNOWN`,
        linkedin: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "LINKEDIN_GET_MY_INFO" and arguments {}. Read the profile's name. Reply with ONLY the name, nothing else. If unsure, reply: UNKNOWN.`,
        whatsapp: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "WHATSAPP_GET_PHONE_NUMBERS" and arguments {}. From the first phone number in the response, read its "verified_name" field (the WhatsApp Business display name). Reply with ONLY that name, nothing else. If unsure, reply: UNKNOWN.`,
        twitter: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "TWITTER_USER_LOOKUP_ME" and arguments {}. Read the "username" field. If present, reply with "@" + username, nothing else. If unsure, reply: UNKNOWN.`,
        telegram: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "TELEGRAM_GET_ME" and arguments {}. Read the bot's "username" field. If present, reply with "@" + username, nothing else. If unsure, reply: UNKNOWN.`,
        facebook: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "FACEBOOK_GET_USER_PAGES" and arguments {}. Read the first page's "name" field. Reply with ONLY that name, nothing else. If unsure, reply: UNKNOWN.`,
        instagram: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "INSTAGRAM_GET_USER_INFO" and arguments {}. Read the "username" field. If present, reply with "@" + username, nothing else. If unsure, reply: UNKNOWN.`,
        // v0.1.26 connectors expansion — identify prompts. For services where
        // no clean "who am I" call exists, the static label avoids spending
        // tokens on a non-resolvable identity probe. The card just shows the
        // service name in those cases.
        supabase: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "SUPABASE_LIST_PROJECTS" and arguments {}. Find the first project's "name" field. Reply with ONLY that name, nothing else. If no projects, reply: UNKNOWN.`,
        "google-drive": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLEDRIVE_GET_ABOUT_ME" and arguments {}. Read the user's emailAddress. Reply with ONLY the bare email, nothing else. If unsure, reply: UNKNOWN.`,
        airtable: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "AIRTABLE_LIST_BASES" and arguments {}. Find the first base's "name" field. Reply with ONLY that name, nothing else. If no bases, reply: UNKNOWN.`,
        firecrawl: `Reply with the single word: UNKNOWN`,
        discord: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "DISCORD_GET_MY_USER" and arguments {}. Read the "username" field. If present, reply with "@" + username. If unsure, reply: UNKNOWN.`,
        onedrive: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "ONEDRIVE_GET_DRIVE" and arguments {}. Read owner.user.displayName. Reply with ONLY that name, nothing else. If unsure, reply: UNKNOWN.`,
        exa: `Reply with the single word: UNKNOWN`,
        elevenlabs: `Reply with the single word: UNKNOWN`,
        salesforce: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "SALESFORCE_QUERY_USER" and arguments {}. Read the user's "Email" field. Reply with ONLY the bare email, nothing else. If unsure, reply: UNKNOWN.`,
        calendly: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "CALENDLY_GET_CURRENT_USER" and arguments {}. Read resource.email. Reply with ONLY the bare email, nothing else. If unsure, reply: UNKNOWN.`,
        "google-meet": `Reply with the single word: UNKNOWN`,
        zoho: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "ZOHO_GET_USER_INFO" and arguments {}. Read the user's email. Reply with ONLY the bare email, nothing else. If unsure, reply: UNKNOWN.`,
        dropbox: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "DROPBOX_GET_CURRENT_ACCOUNT" and arguments {}. Read the email field. Reply with ONLY the bare email, nothing else. If unsure, reply: UNKNOWN.`,
        heygen: `Reply with the single word: UNKNOWN`,
        yousearch: `Reply with the single word: UNKNOWN`,
        retellai: `Reply with the single word: UNKNOWN`,
        canva: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "CANVA_GET_CURRENT_USER" and arguments {}. Read the display name. Reply with ONLY that name, nothing else. If unsure, reply: UNKNOWN.`,
        "cal-com": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "CAL_GET_ME" and arguments {}. Read the "username" field. If present, reply with "@" + username. If unsure, reply: UNKNOWN.`,
        telnyx: `Reply with the single word: UNKNOWN`,
        cloudflare: `Reply with the single word: UNKNOWN`,
        reddit: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "REDDIT_GET_ME" and arguments {}. Read the "name" field. If present, reply with "u/" + name. If unsure, reply: UNKNOWN.`,
        cloudinary: `Reply with the single word: UNKNOWN`,
        convex: `Reply with the single word: UNKNOWN`,
        dockerhub: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "DOCKERHUB_GET_USER" and arguments {}. Read the "username" field. If present, reply with "@" + username. If unsure, reply: UNKNOWN.`,
        excel: `Reply with the single word: UNKNOWN`,
        "google-maps": `Reply with the single word: UNKNOWN`
      };
      const prompt = prompts[service] ?? "Reply with: UNKNOWN";
      const res = await invoke<{ response: string }>("run_task", {
        prompt,
        claudePath: claude.path,
        streamId: newId("identify"),
        // Haiku for identify — one-tool-call extraction, ~3x faster than Sonnet/Opus.
        model: "haiku",
      });
      const raw = (res?.response || "").trim();
      const emailMatch = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const handleMatch = raw.match(/@[A-Za-z0-9_.-]{2,}/);
      const redditMatch = raw.match(/\bu\/[A-Za-z0-9_-]{2,}/);
      // Last-resort fallback: a short, single-line, non-sentence response.
      // Some toolkits (Supabase project name, OneDrive displayName) return
      // plain strings that don't match @handle / email patterns. We only
      // accept up to 60 chars and reject anything that looks like prose
      // ("the user is", "your account", etc.).
      const isUnknown = raw.toUpperCase().includes("UNKNOWN");
      const looksLikeProse = /\b(the |your |this |is |are |was )/i.test(raw);
      const shortPlain =
        !isUnknown &&
        raw.length > 0 &&
        raw.length <= 60 &&
        !raw.includes("\n") &&
        !looksLikeProse
          ? raw
          : null;
      const label =
        emailMatch?.[0] ||
        (handleMatch?.[0] && !isUnknown ? handleMatch[0] : null) ||
        (redditMatch?.[0] && !isUnknown ? redditMatch[0] : null) ||
        shortPlain;
      if (label) {
        setLocalLabels((cur) => ({ ...cur, [service]: label }));
        await invoke("set_setting", { key: `connector_label_${service}`, value: label }).catch(() => undefined);
      }
    } catch {
      // Non-fatal — card just shows "Connected" without the email.
    } finally {
      setIdentifying((s) => {
        const next = new Set(s);
        next.delete(service);
        return next;
      });
    }
  }

  // Hydrate local labels + a synthetic "looks-connected" mirror from the
  // settings DB on first mount. Uses the single-call `list_connector_status`
  // IPC (returns every known connector's label in one round-trip) instead of
  // 44 per-service get_setting fan-outs — that was costing ~500-900ms cold.
  //
  // The synthetic mirror is what makes the page feel instant: cards for
  // services we've previously connected render as "Connected" before the
  // relay ever responds. The real relay call still runs in parallel and
  // refines the picture (sets composio_connection_id, refreshes stale labels,
  // surfaces pending/expired/error states the local cache can't know about).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke<{ connectors: Record<string, { connected: boolean; label: string | null }> }>(
          "list_connector_status"
        );
        if (cancelled || !res?.connectors) return;
        const stored: Record<string, string> = {};
        const syntheticRows: RelayConnection[] = [];
        for (const [service, info] of Object.entries(res.connectors)) {
          if (info?.label) stored[service] = info.label;
          if (info?.connected) {
            syntheticRows.push({
              id: `local:${service}`,
              service,
              composio_connection_id: "",
              status: "connected",
              account_label: info.label ?? null,
              connected_at: null,
            } as RelayConnection);
          }
        }
        if (Object.keys(stored).length > 0) {
          setLocalLabels((cur) => ({ ...stored, ...cur }));
        }
        // Only seed liveConnections if relay hasn't already responded; once
        // we have real rows we never want to clobber them with synthetics.
        if (syntheticRows.length > 0) {
          setLiveConnections((cur) => (cur.length === 0 ? syntheticRows : cur));
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [liveConnections, setLiveConnections] = useState<RelayConnection[]>([]);
  const [busyService, setBusyService] = useState<string | null>(null);
  const [stalledServices, setStalledServices] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [credsModalService, setCredsModalService] = useState<string | null>(null);
  // WhatsApp Personal state, driven by whatsapp_update broadcasts from the
  // main process. Drives both the card status pill on the Connectors grid AND
  // the open/closed state of the QR pairing modal.
  const [whatsappPersonal, setWhatsappPersonal] = useState<WhatsAppPersonalState>({
    status: "disconnected",
    phoneNumber: null
  });
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [waModalOpen, setWaModalOpen] = useState(false);
  // Each entry tracks an active poll so cancel can abort + clean up the right row.
  const activePollsRef = useRef<Map<string, { aborted: boolean; connectionId: string }>>(new Map());

  // Pull initial WhatsApp Personal status on mount + subscribe to live updates.
  // The worker may auto-start at app launch (when a saved session exists), so
  // the card needs to reflect that without the user having to interact.
  useEffect(() => {
    invoke<{ status: WhatsAppPersonalState["status"]; qr: string | null; phoneNumber: string | null }>("whatsapp_status")
      .then((res) => {
        if (res?.status) setWhatsappPersonal({ status: res.status, phoneNumber: res.phoneNumber ?? null });
        if (res?.qr) setWhatsappQr(res.qr);
      })
      .catch(() => undefined);
    const off = window.aios.onUpdateState((data: any) => {
      if (data?.state !== "whatsapp_update") return;
      setWhatsappPersonal({
        status: data.status,
        phoneNumber: data.phoneNumber ?? null
      });
      setWhatsappQr(data.qr ?? null);
    });
    return off;
  }, []);

  // Auto-dismiss the QR modal a moment after a successful pairing.
  useEffect(() => {
    if (!waModalOpen) return;
    if (whatsappPersonal.status !== "connected") return;
    const timer = window.setTimeout(() => setWaModalOpen(false), 1500);
    return () => window.clearTimeout(timer);
  }, [waModalOpen, whatsappPersonal.status]);

  const connectors = useMemo(
    () => mergeConnections(CONNECTOR_CATALOG, liveConnections, stalledServices, localLabels, whatsappPersonal),
    [liveConnections, stalledServices, localLabels, whatsappPersonal]
  );
  
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return connectors.filter(c => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
  }, [connectors, searchQuery]);

  const connectedCount = useMemo(() => connectors.filter((c) => c.status === "connected").length, [connectors]);
  const totalActive = useMemo(() => connectors.filter((c) => !c.comingSoon).length, [connectors]);

  const hasSyncedMcpRef = useRef(false);

  async function refresh() {
    try {
      const res = await relay.listConnections(deviceUserId);
      setLiveConnections(res.connections);
      setError(null);
      // First time we see any active connection on this page-load, push the
      // MCP config to Claude. Idempotent thereafter; pollForConnect re-syncs
      // when a brand-new connection lands. Both run as background work so
      // they never block rendering.
      // Always re-sync the MCP URL when we observe any connected service.
      // Composio's `composio.create(userId)` may return a fresh session URL
      // tied to the latest tokens; if we don't re-fetch, Claude can end up
      // pointed at a stale session bound to an old/wrong OAuth account.
      if (res.connections.some((c) => c.status === "connected")) {
        hasSyncedMcpRef.current = true;
        window.setTimeout(() => { void syncMcpToClaude(); }, 0);
      }
      // For any newly-connected service without a local label, ask Claude to
      // identify the account. Short delay (250ms) so syncMcpToClaude's file
      // write has settled before identify spawns — was 1500ms, but the Mac
      // strict-mcp-config path doesn't actually need that long.
      for (const c of res.connections) {
        if (c.status === "connected" && !localLabels[c.service]) {
          window.setTimeout(() => { void identifyAccount(c.service); }, 250);
        }
      }
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!RELAY_AVAILABLE) {
      setError("Connectors backend is not configured. Set VITE_AIOS_RELAY_URL in renderer/.env and restart the dev server.");
      setLoading(false);
      return;
    }
    if (!deviceUserId) return;
    refresh();
    // Heartbeat refresh only when the page is actually visible. Connectors
    // page state rarely changes outside the active OAuth poll window, so
    // 2-minute cadence is plenty for catching webhook-driven status flips.
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refresh();
    }, 120_000);
    return () => {
      window.clearInterval(heartbeat);
      for (const guard of activePollsRef.current.values()) guard.aborted = true;
      activePollsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceUserId]);

  function clearStalled(service: string) {
    setStalledServices((current) => {
      if (!current.has(service)) return current;
      const next = new Set(current);
      next.delete(service);
      return next;
    });
  }

  async function syncMcpToClaude() {
    // Pull the current Composio MCP session config and merge it into Claude
    // Code's settings.json. Called every time a connection completes so Claude
    // sees the latest tool router on its next launch.
    try {
      const cfg = await relay.getMcpConfig(deviceUserId);
      // The relay returns { mcp: {type, url, headers, ...}, ... }.
      const mcpEntry = (cfg as any).mcp ?? null;
      if (!mcpEntry) return;
      await invoke("update_claude_mcp", { name: "composio", config: mcpEntry });
    } catch {
      // Non-fatal — the connection still works, the user just won't have
      // Claude tools wired up until the next time we try.
    }
  }

  async function pollForConnect(service: string, connectionId: string) {
    // Cancel any prior poll for this same service.
    const prior = activePollsRef.current.get(service);
    if (prior) prior.aborted = true;
    const guard = { aborted: false, connectionId };
    activePollsRef.current.set(service, guard);

    const deadline = Date.now() + 90_000; // 90s window
    while (Date.now() < deadline && !guard.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (guard.aborted) return;
      try {
        const res = await relay.listConnections(deviceUserId);
        setLiveConnections(res.connections);
        const found = res.connections.find((c) => c.service === service);
        if (found?.status === "connected") {
          activePollsRef.current.delete(service);
          // Connection landed: push MCP config to Claude first (so identify
          // has Gmail tools available), then ask Claude to identify the
          // connected account email.
          await syncMcpToClaude();
          window.setTimeout(() => { void identifyAccount(service); }, 1500);
          return;
        }
      } catch {
        // Keep polling; transient errors recover.
      }
    }
    // Reached deadline without success → mark stalled so user sees Retry/Cancel.
    if (!guard.aborted) {
      setStalledServices((current) => new Set(current).add(service));
      activePollsRef.current.delete(service);
    }
  }

  async function connect(service: string) {
    // Local-auth connectors (WhatsApp Personal via Baileys): no relay, no
    // OAuth — kick off the device-local worker and open the QR modal. The
    // modal subscribes to the same whatsapp_update events the card listens
    // to, so all three (card, modal, worker) stay in sync.
    const entry = CONNECTOR_CATALOG.find((c) => c.service === service);
    if (entry?.localAuth === "baileys-qr") {
      setError(null);
      setWaModalOpen(true);
      try {
        await invoke("whatsapp_start");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`WhatsApp scanner failed to start: ${msg}`);
        setWaModalOpen(false);
      }
      return;
    }
    // Services that need user-provided fields (e.g. WhatsApp WABA ID) get a
    // credentials modal first; the actual initiate happens in submitCreds().
    if (CONNECTOR_FIELD_REQUIREMENTS[service]) {
      setError(null);
      clearStalled(service);
      setCredsModalService(service);
      return;
    }
    setBusyService(service);
    setError(null);
    clearStalled(service);
    try {
      const { redirectUrl, connectionId } = await relay.initiate(deviceUserId, service);
      if (!redirectUrl) throw new Error("Relay did not return an OAuth redirect URL.");
      const open = await window.aios.openExternal(redirectUrl);
      if (!open.ok) throw new Error(open.error || "Failed to open external browser");
      await refresh();
      pollForConnect(service, connectionId);
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  async function submitCreds(service: string, values: Record<string, string>) {
    const requirements = CONNECTOR_FIELD_REQUIREMENTS[service];
    if (!requirements) return;
    setCredsModalService(null);
    setBusyService(service);
    setError(null);
    try {
      const { redirectUrl, connectionId, status } = await relay.initiate(deviceUserId, service, {
        authScheme: requirements.authScheme,
        val: values,
      });
      // API_KEY auth (e.g. Telegram bot token) is accepted synchronously by
      // Composio — relay returns status: "connected" and no redirectUrl. Skip
      // the browser and just refresh to pick up the now-connected row.
      if (status === "connected" || !redirectUrl) {
        await refresh();
        return;
      }
      const open = await window.aios.openExternal(redirectUrl);
      if (!open.ok) throw new Error(open.error || "Failed to open external browser");
      await refresh();
      pollForConnect(service, connectionId);
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  // Cancel works in two cases:
  //   1. Polling for completion → stop the poll AND tell Composio to drop
  //      the pending account so retry can start fresh.
  //   2. Stalled state → same cleanup, just no poll to stop.
  // Optimistic UI: flip the card back to not_connected immediately so the
  // user gets instant feedback. The 3 chained network calls (listConnections
  // → disconnect → refresh) run in the background. If a probe later finds
  // that the OAuth actually succeeded mid-cancel, refresh restores it.
  async function cancel(service: string, connectionId?: string) {
    setError(null);
    // Stop the active poll first so it can't write back into liveConnections.
    const guard = activePollsRef.current.get(service);
    if (guard) {
      guard.aborted = true;
      activePollsRef.current.delete(service);
    }
    // Optimistic: instant visual feedback — drop the pending row + stalled flag.
    const previousConnections = liveConnections;
    setLiveConnections((current) => current.filter((c) => c.service !== service));
    clearStalled(service);
    // Network cleanup runs in the background.
    void (async () => {
      try {
        if (connectionId) {
          await relay.disconnect(deviceUserId, connectionId).catch(() => undefined);
        }
        // Re-sync with relay to catch the edge case where OAuth completed
        // simultaneously — refresh will restore the row as "connected" if so.
        const fresh = await relay.listConnections(deviceUserId);
        setLiveConnections(fresh.connections);
      } catch (err) {
        // Roll back optimistic update on hard failure so the user can retry.
        setLiveConnections(previousConnections);
        const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }

  async function retry(service: string, connectionId?: string) {
    // Same cleanup as cancel, but re-initiates immediately afterwards. Must
    // await the disconnect inline (instead of fire-and-forget) so the upsert
    // in handleInitiate doesn't race a pending DELETE on the same row.
    const guard = activePollsRef.current.get(service);
    if (guard) {
      guard.aborted = true;
      activePollsRef.current.delete(service);
    }
    setLiveConnections((current) => current.filter((c) => c.service !== service));
    clearStalled(service);
    if (connectionId) {
      await relay.disconnect(deviceUserId, connectionId).catch(() => undefined);
    }
    await connect(service);
  }

  async function disconnect(service: string, connectionId?: string) {
    // Local-auth connectors: tear down the Baileys worker via the existing
    // whatsapp_stop IPC. The scanner clears its session folder so the next
    // Connect shows a fresh QR.
    const entry = CONNECTOR_CATALOG.find((c) => c.service === service);
    if (entry?.localAuth === "baileys-qr") {
      setError(null);
      try {
        await invoke("whatsapp_stop");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`WhatsApp scanner failed to stop: ${msg}`);
      }
      return;
    }
    setBusyService(service);
    setError(null);
    // Optimistically clear the card right away so the user sees feedback.
    // If the relay roundtrip fails, the heartbeat will repopulate it.
    const previousConnections = liveConnections;
    setLiveConnections((current) => current.filter((c) => c.service !== service));
    setLocalLabels((cur) => {
      const next = { ...cur };
      delete next[service];
      return next;
    });
    identifyAttemptedRef.current.delete(service);
    try { await invoke("set_setting", { key: `connector_label_${service}`, value: "" }); }
    catch { /* non-fatal */ }
    try {
      if (connectionId) {
        await relay.disconnect(deviceUserId, connectionId);
      }
      const res = await relay.listConnections(deviceUserId);
      setLiveConnections(res.connections);
      // If no connections remain, remove the MCP entry from Claude's settings
      // so the next chat doesn't try to talk to a dead tool router.
      if (!res.connections.some((c) => c.status === "connected")) {
        try { await invoke("update_claude_mcp", { name: "composio", config: null }); }
        catch { /* non-fatal */ }
        hasSyncedMcpRef.current = false;
      }
    } catch (err) {
      // Roll back the optimistic update so the user can see the connection is
      // still there and retry. Surface the error.
      setLiveConnections(previousConnections);
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  return (
    <section className="connectors-screen">
      <div className="connectors-shell">
        <header className="connectors-hero">
          <div className="connectors-hero-text">
            <p className="layer-badge"><span className="layer-dot" aria-hidden="true" />Layer · Connectors</p>
            <h1>Your <em>connections</em></h1>
            <p className="connectors-hero-detail">
              Plug your services in once. Claude can read and act on them inside any chat — no custom prompts, no copy-paste.
            </p>
          </div>
          <div className="connectors-overview">
            <Plug size={13} />
            <span><strong>{connectedCount}</strong> / {totalActive} connected</span>
          </div>
        </header>

        <div className="connectors-search-bar">
          <div className="connectors-search-inner">
            <Search size={16} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search services..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery("")}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {error ? (
          <div className="connectors-error">
            <strong>Connectors error:</strong> {error}
          </div>
        ) : null}

        {loading && liveConnections.length === 0 ? (
          <div className="connectors-status-pill">
            <Loader2 size={14} className="spin" />
            <span>Syncing with relay…</span>
          </div>
        ) : null}
        {searchQuery ? (
          <div className="connectors-grid">
            {filteredCatalog.map((connector) => (
              <ConnectorCard
                key={connector.service}
                connector={connector}
                isBusy={busyService === connector.service}
                isIdentifying={identifying.has(connector.service)}
                onConnect={() => connect(connector.service)}
                onCancel={() => cancel(connector.service, connector.connectionId)}
                onRetry={() => retry(connector.service, connector.connectionId)}
                onDisconnect={() => disconnect(connector.service, connector.connectionId)}
              />
            ))}
          </div>
        ) : (
          CATEGORY_ORDER.map((category) => {
            const rows = filteredCatalog
              .filter((c) => (CATEGORY_OF[c.service] ?? "Web, Search & Tools") === category)
              .slice()
              .sort((a, b) => {
                const ra = STATUS_RANK[a.status] ?? 99;
                const rb = STATUS_RANK[b.status] ?? 99;
                if (ra !== rb) return ra - rb;
                return a.label.localeCompare(b.label);
              });
            if (rows.length === 0) return null;
            return (
              <section key={category} className="connectors-section">
                <h3 className="connectors-section-title">{category}</h3>
                <div className="connectors-grid">
                  {rows.map((connector) => (
                    <ConnectorCard
                      key={connector.service}
                      connector={connector}
                      isBusy={busyService === connector.service}
                      isIdentifying={identifying.has(connector.service)}
                      onConnect={() => connect(connector.service)}
                      onCancel={() => cancel(connector.service, connector.connectionId)}
                      onRetry={() => retry(connector.service, connector.connectionId)}
                      onDisconnect={() => disconnect(connector.service, connector.connectionId)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
      {credsModalService && CONNECTOR_FIELD_REQUIREMENTS[credsModalService] && (
        <ConnectorCredsModal
          service={credsModalService}
          label={CONNECTOR_CATALOG.find((c) => c.service === credsModalService)?.label || credsModalService}
          requirements={CONNECTOR_FIELD_REQUIREMENTS[credsModalService]}
          onCancel={() => setCredsModalService(null)}
          onSubmit={(values) => submitCreds(credsModalService, values)}
        />
      )}
      {waModalOpen && (
        <WhatsAppQrModal
          status={whatsappPersonal.status}
          qr={whatsappQr}
          phoneNumber={whatsappPersonal.phoneNumber}
          onClose={async () => {
            setWaModalOpen(false);
            // If the user dismisses while pairing is in progress, stop the
            // worker so we don't leave a half-paired session behind. If we're
            // already connected, leave it alone — they're just closing the
            // dialog, not disconnecting.
            if (whatsappPersonal.status === "qr" || whatsappPersonal.status === "authenticating") {
              try { await invoke("whatsapp_stop"); } catch { /* non-fatal */ }
            }
          }}
        />
      )}
    </section>
  );
}

function ConnectorCredsModal({
  service,
  label,
  requirements,
  onCancel,
  onSubmit,
}: {
  service: string;
  label: string;
  requirements: { authScheme: string; fields: FieldRequirement[] };
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const allFilled = requirements.fields.every((f) => (values[f.key] ?? "").trim().length > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allFilled) return;
    const trimmed: Record<string, string> = {};
    for (const f of requirements.fields) trimmed[f.key] = (values[f.key] ?? "").trim();
    onSubmit(trimmed);
  }

  return (
    <div className="connector-creds-overlay" role="dialog" aria-modal="true" aria-labelledby={`creds-${service}-title`}>
      <form className="connector-creds-card" onSubmit={handleSubmit}>
        <header className="connector-creds-head">
          <h2 id={`creds-${service}-title`}>Connect <em>{label}</em></h2>
          <button type="button" className="connector-creds-close" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="connector-creds-body">
          {requirements.fields.map((f) => (
            <label key={f.key} className="connector-creds-field">
              <span className="connector-creds-label">{f.label}</span>
              <input
                type={f.secret ? "password" : "text"}
                className="connector-creds-input"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
              <span className="connector-creds-help">{f.description}</span>
            </label>
          ))}
        </div>
        <div className="connector-creds-note">
          <p className="connector-creds-note-title">Where to find this</p>
          {requirements.fields.map((f) => (
            <p key={`note-${f.key}`} className="connector-creds-note-body">
              {f.helpText}
              {f.helpLink && (
                <>
                  {" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      void window.aios.openExternal(f.helpLink!);
                    }}
                  >
                    {f.helpLinkLabel ?? "Open link"}
                  </a>
                </>
              )}
            </p>
          ))}
        </div>
        <footer className="connector-creds-foot">
          <button type="button" className="connector-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="connector-btn is-primary" disabled={!allFilled}>
            <ExternalLink size={13} /> Continue to {label}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ConnectorCard({
  connector,
  isBusy,
  isIdentifying,
  onConnect,
  onCancel,
  onRetry,
  onDisconnect
}: {
  connector: ConnectorView;
  isBusy: boolean;
  isIdentifying: boolean;
  onConnect: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDisconnect: () => void;
}) {
  const { label, description, Icon, comingSoon, status, accountLabel } = connector;
  const isConnected = status === "connected";
  // "connecting" = backend has a pending row AND we're actively polling.
  const isConnecting = status === "connecting";
  const isStalled = status === "stalled";
  const isExpired = status === "expired";
  // If the hosted logo URL fails (CDN 404, network blip, brand removed
  // their favicon), fall back to the Lucide icon instead of showing a
  // broken-image glyph. Resets per card via useState scoped to ConnectorCard.
  const [logoErrored, setLogoErrored] = useState(false);

  return (
    <article
      className={
        `connector-card ` +
        `${isConnected ? "is-connected" : ""} ` +
        `${comingSoon ? "is-soon" : ""} ` +
        `${isStalled ? "is-stalled" : ""}`
      }
    >
      <div className="connector-card-head">
        <div className="connector-icon" aria-hidden="true">
          {connector.logoUrl && !logoErrored ? (
            <img
              src={connector.logoUrl}
              alt=""
              style={{
                width: 18,
                height: 18,
                objectFit: "contain",
                filter: "none",
                opacity: 1,
                transition: "all 0.3s ease"
              }}
              className="connector-logo-img"
              onError={() => setLogoErrored(true)}
            />
          ) : (
            <Icon size={18} />
          )}
        </div>
        <div className="connector-card-title">
          <strong>{label}</strong>
          <p>{description}</p>
        </div>
      </div>

      <div className="connector-card-status">
        {comingSoon ? (
          <span className="connector-status-pill is-soon">
            <span className="connector-dot" /> Coming soon
          </span>
        ) : isConnected ? (
          // Always show Check + Connected immediately. Account-email lookup
          // runs silently in the background; the label fades in when ready.
          // Showing a spinner here made users feel a connection wasn't complete
          // for ~10s after OAuth, even though it actually was.
          <span className="connector-status-pill is-connected">
            <Check size={11} />
            <span className="connector-status-label">
              {accountLabel || "Connected"}
            </span>
          </span>
        ) : isExpired ? (
          <span className="connector-status-pill is-soon">
            <span className="connector-dot" /> Expired — reconnect
          </span>
        ) : isStalled ? (
          <span className="connector-status-pill is-soon">
            <span className="connector-dot" /> No response — try again
          </span>
        ) : isConnecting ? (
          <span className="connector-status-pill is-soon">
            <Loader2 size={11} className="spin" /> Waiting for OAuth…
          </span>
        ) : (
          <span className="connector-status-pill is-off">
            <span className="connector-dot" /> Not connected
          </span>
        )}
      </div>

      <div className="connector-card-actions">
        {comingSoon ? (
          <button type="button" className="connector-btn is-disabled" disabled>
            Coming soon
          </button>
        ) : isConnected ? (
          <button type="button" className="connector-btn is-secondary" onClick={onDisconnect} disabled={isBusy}>
            <X size={13} />
            Disconnect
          </button>
        ) : isConnecting ? (
          <>
            <button type="button" className="connector-btn is-secondary" onClick={onCancel} disabled={isBusy}>
              <X size={13} />
              Cancel
            </button>
          </>
        ) : isStalled ? (
          <>
            <button type="button" className="connector-btn is-secondary" onClick={onCancel} disabled={isBusy}>
              <X size={13} />
              Cancel
            </button>
            <button type="button" className="connector-btn is-primary" onClick={onRetry} disabled={isBusy}>
              {isBusy ? <Loader2 size={13} className="spin" /> : <ExternalLink size={13} />}
              Retry
            </button>
          </>
        ) : (
          <button
            type="button"
            className="connector-btn is-primary"
            onClick={onConnect}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 size={13} className="spin" /> : <ExternalLink size={13} />}
            {isExpired ? `Reconnect ${label}` : `Connect ${label}`}
          </button>
        )}
      </div>
    </article>
  );
}

function WhatsAppQrModal({
  status,
  qr,
  phoneNumber,
  onClose
}: {
  status: "disconnected" | "qr" | "authenticating" | "connected";
  qr: string | null;
  phoneNumber: string | null;
  onClose: () => void;
}) {
  // Close on Escape — same affordance every other modal in the app uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wa-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wa-modal-title" onClick={onClose}>
      <div className="wa-modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="wa-modal-head">
          <div>
            <p className="wa-modal-eyebrow">Connector</p>
            <h2 id="wa-modal-title">Link your <em>WhatsApp</em></h2>
          </div>
          <button type="button" className="wa-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {status === "qr" && qr ? (
          <div className="wa-modal-body wa-modal-body-qr">
            <ol className="wa-modal-steps">
              <li>Open <strong>WhatsApp</strong> on your phone</li>
              <li>Tap <strong>Settings → Linked Devices</strong></li>
              <li>Tap <strong>Link a Device</strong> and scan this code</li>
            </ol>
            <div className="wa-modal-qr">
              <img src={qr} alt="WhatsApp pairing QR code" />
            </div>
            <p className="wa-modal-status wa-modal-status-pending">Waiting for scan…</p>
          </div>
        ) : status === "authenticating" ? (
          <div className="wa-modal-body wa-modal-body-status">
            <Loader2 size={28} className="spin wa-modal-spinner" />
            <p className="wa-modal-status">Linking your account…</p>
            <p className="wa-modal-sub">This usually takes 5–15 seconds.</p>
          </div>
        ) : status === "connected" ? (
          <div className="wa-modal-body wa-modal-body-status">
            <div className="wa-modal-check"><Check size={28} /></div>
            <p className="wa-modal-status wa-modal-status-ok">
              Connected{phoneNumber ? ` as ${formatPhoneNumber(phoneNumber)}` : ""}
            </p>
            <p className="wa-modal-sub">Text yourself on WhatsApp to talk to AIOS.</p>
          </div>
        ) : (
          <div className="wa-modal-body wa-modal-body-status">
            <Loader2 size={28} className="spin wa-modal-spinner" />
            <p className="wa-modal-status">Starting…</p>
          </div>
        )}
      </div>
    </div>
  );
}


