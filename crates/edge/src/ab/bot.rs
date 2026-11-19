//! Bot / crawler detection synchronized with `lib/analytics/parse.ts` plus
//! search-engine and LLM crawlers.
//!
//! Bots ALWAYS receive Control A with NO `Set-Cookie`, protecting SEO canonical
//! indexing and keeping experiment counts clean.

use once_cell::sync::Lazy;
use regex::Regex;

static BOT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)bot/|spider|crawler|slurp|mediapartners|googlebot|bingbot|applebot|yandexbot|duckduckbot|baiduspider|gptbot|claudebot|perplexitybot|oai-searchbot|facebookexternalhit|whatsapp/|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|redditbot|pinterest/|embedly|skypeuripreview|vkshare|tumblr/|bitlybot|nuzzel|w3c_validator|semrush|ahrefs|mj12bot|dotbot|dataforseo|screaming frog|headless|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|datadog|newrelic|curl/|wget/|python-requests|python-urllib|aiohttp|httpx|axios/|go-http-client|java/|okhttp|node-fetch|scrapy|httpclient|libwww|mechanize|guzzle|postman|insomnia",
    )
    .expect("valid bot regex")
});

/// True for automated traffic / crawlers / empty UAs. Uses `bot/` and explicit
/// bot names rather than bare `bot` so real mobile devices like `Cubot` stay human.
pub fn is_bot(user_agent: &str) -> bool {
    let trimmed = user_agent.trim();
    if trimmed.is_empty() {
        return true;
    }
    BOT_RE.is_match(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_search_social_llm_and_cli_bots() {
        for ua in [
            "",
            "   ",
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)",
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0",
            "ClaudeBot/1.0",
            "WhatsApp/2.24.1 N",
            "Twitterbot/1.0",
            "Mozilla/5.0 Chrome-Lighthouse",
            "curl/8.7.1",
        ] {
            assert!(is_bot(ua), "expected bot for UA: {ua}");
        }
    }

    #[test]
    fn allows_real_browsers_and_cubot_phones() {
        for ua in [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Linux; Android 13; CUBOT P80) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        ] {
            assert!(!is_bot(ua), "expected human for UA: {ua}");
        }
    }
}
