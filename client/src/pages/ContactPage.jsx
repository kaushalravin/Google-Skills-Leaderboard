import '../styles/ContactPage.css'

const ORGANIZERS = [
  { name: 'Hariharan',      phone: '+91 95973 53283', initials: 'H', color: '#4285F4' },
  { name: 'Praveen',        phone: '+91 95009 95591', initials: 'P', color: '#34A853' },
  { name: 'Thamarai Selvi', phone: '+91 73052 48835', initials: 'T', color: '#EA4335' },
]

const WHATSAPP_LINK = 'https://chat.whatsapp.com/GBPVI8xuH5IINL3n8emK7o'
const GDG_LINK = 'https://gdg.community.dev/gdg-on-campus-madras-institute-of-technology-chennai-india/'

export default function ContactPage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="contact-page">
        {/* Header */}
        <header className="contact-header">
          <p className="contact-header__eyebrow">Get in touch</p>
          <h1 className="contact-header__title">Contact Us</h1>
          <p className="contact-header__desc">
            Reach out to the GDG on Campus MIT organizers for any queries about
            the campaign, leaderboard, or swag eligibility.
          </p>
        </header>

        {/* Organizers */}
        <section className="contact-section">
          <h2 className="contact-section__heading">Organizers</h2>
          <div className="contact-organizers">
            {ORGANIZERS.map((org) => (
              <article key={org.name} className="organizer-card">
                <div className="organizer-card__avatar" style={{ backgroundColor: org.color }}>
                  {org.initials}
                </div>
                <div className="organizer-card__info">
                  <p className="organizer-card__name">{org.name}</p>
                  <a
                    href={`tel:${org.phone.replace(/\s/g, '')}`}
                    className="organizer-card__phone"
                  >
                    {org.phone}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Community links */}
        <section className="contact-section">
          <h2 className="contact-section__heading">Join the community</h2>
          <div className="contact-links">
            {/* WhatsApp */}
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="contact-cta contact-cta--whatsapp"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.472-.148-.67.15-.198.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.447-.52.151-.174.2-.298.3-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.135.561 4.137 1.535 5.874L.057 23.64a.5.5 0 0 0 .614.614l5.766-1.478A11.935 11.935 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.796 9.796 0 0 1-4.998-1.368l-.358-.213-3.716.952.969-3.717-.234-.372A9.797 9.797 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
              </svg>
              <span>Join WhatsApp Community</span>
              <span className="visually-hidden">(opens in a new tab)</span>
            </a>

            {/* GDG Community page */}
            <a
              href={GDG_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="contact-cta contact-cta--gdg"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              <span>GDG on Campus MIT</span>
              <span className="visually-hidden">(opens in a new tab)</span>
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
