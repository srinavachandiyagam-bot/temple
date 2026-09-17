# Nava Chandi Yagam Admin Panel — Customization Requirements

## Project
- Website: `navachandiyagam.online`
- Event: Nava Chandi Yagam
- Date: 18/10/2026
- Time: 7:00 AM
- Participation amount: ₹1,000
- Venue: Arulmigu Sri Mariamman Temple, Senthampalayam, Kavindapadi, Erode District – 638455
- Organizer: Temple Committee Members
- Google Maps: https://maps.app.goo.gl/qMuATXdpUUyAJoBz6?g_st=ic

## Main requirement
The admin panel must allow the temple committee to manage the website without editing code. Changes made in the admin panel should appear on the public website.

## 1. Dashboard
Show:
- Total registrations
- Paid registrations
- Pending registrations
- Failed registrations
- Total amount collected
- Recent registrations
- Recent payment activity
- Quick buttons for Add Photo, Add Video, View Registrations, Export CSV

## 2. General Website Details
Admin should be able to edit:
- Website/page title in English
- Website/page title in Tamil
- Tagline in English
- Tagline in Tamil
- Footer text
- Organizer name
- WhatsApp number
- Google Maps URL
- Contact person 1 name + phone
- Contact person 2 name + phone
- Contact person 3 name + phone
- Contact names in Tamil and English where required

Do not show Hindi anywhere. The website language options should be English and Tamil only.

## 3. Hero Section
Admin should be able to:
- Upload/change hero image
- Set hero image opacity
- Edit eyebrow/small heading
- Edit main title in Tamil and English
- Edit description in Tamil and English
- Edit Register button text
- Edit Learn More button text
- Enable/disable buttons if needed

Hero image requirement:
- Full-width/full-height background style
- Image should not appear as a small partial image
- Text should remain readable over the image
- Use a translucent overlay/opacity

## 4. About Nava Chandi Yagam
Admin should be able to edit the complete About section in Tamil and English.

Include editable benefit/info cards:
- Card title
- Card description
- Icon/symbol if supported

The About section should have a decorative religious/event design but remain clean and readable.

## 5. Event Details
Editable fields:
- Event name
- Date
- Time
- Venue
- District/state/pincode
- Participation amount
- Payment instructions/notes
- Additional event instructions

Current event:
- 18/10/2026
- 7:00 AM
- Arulmigu Sri Mariamman Temple, Senthampalayam, Kavindapadi, Erode District – 638455
- ₹1,000

## 6. Registration Form Settings
Admin should control:
- Maximum family members per main participant: 4
- Whether email is required
- Whether address is required
- Whether Gothram is required
- Registration instructions

Registration must support:
- Main participant name
- Main participant Rasi
- Main participant Natchathiram
- Main participant Gothram
- Up to 4 family members
- Each family member: name, Rasi, Natchathiram, Gothram

Rasi dropdown must contain all 12 Rasis.
Natchathiram dropdown must contain all 27 Natchathirams.

## 7. Photos / Gallery
Admin should be able to:
- Upload photos
- Delete photos
- Set a photo as the hero image
- Edit photo title/caption
- View uploaded photos in a grid

Allowed image types:
- JPG/JPEG
- PNG
- WEBP
- GIF

Maximum upload size should be suitable for normal website use (current implementation: up to 8 MB).

## 8. Videos
Admin should be able to:
- Upload videos
- Delete videos
- Add/edit video title
- View uploaded videos

Supported formats in current implementation:
- MP4
- WebM
- MOV
- MKV

Current upload limit: 150 MB.

## 9. Payment Settings
Use Cashfree as the payment gateway.

Admin should be able to configure/select:
- Cashfree Sandbox/Production mode
- Currency
- UPI availability/status
- Payment notes

Sensitive Cashfree credentials must NOT be displayed publicly and must NOT be stored in normal website content fields.
Use server environment variables for:
- CASHFREE_ENV
- CASHFREE_CLIENT_ID
- CASHFREE_CLIENT_SECRET
- CASHFREE_API_VERSION
- PUBLIC_BASE_URL

## 10. Registrations & Payments
Admin should be able to view:
- Registration ID
- Participant name
- Phone
- Email
- Address
- Main participant Rasi
- Main participant Natchathiram
- Main participant Gothram
- Family member details
- Registration date/time
- Payment status
- Payment ID
- Order ID
- Cashfree order ID
- Payment time
- Bank reference
- Payment message
- Payment method

Admin actions:
- Refresh registrations
- Sync Cashfree payment
- Update registration/payment status where appropriate
- Export registrations to CSV

## 11. Payment status
Use clear statuses such as:
- Paid
- Pending
- Failed
- Cancelled if needed

Do not mark a payment as Paid merely because the registration form was submitted. Payment confirmation must come from the payment system/webhook or verified sync.

## 12. WhatsApp button
Keep a fixed WhatsApp button visible while scrolling.

WhatsApp target:
- 9150232419

The button should open WhatsApp chat with a suitable pre-filled message.

## 13. Contact section
Display (Primary clearly marked, all tel: links clickable):
- MARIMUTHU — 9150232419 — PRIMARY CONTACT
- MEVI MURUGAN — 7539953653
- BALAJI — 6381606039
- Abishek Marimuthu — 8838581693
- Email: srinavachandiyagam@gmail.com

The contact section should have clickable phone links on mobile. Footer must also show: "Website Managed by Abishek Marimuthu"

## 14. Map
Use the exact Google Maps link:
https://maps.app.goo.gl/qMuATXdpUUyAJoBz6?g_st=ic

Admin must be able to change the map URL later.

## 15. Language switch
Languages:
- தமிழ்
- English

Requirements:
- Language switch must work for all public website sections.
- Do not include Hindi.
- Admin content should have separate Tamil and English fields where translation is needed.
- The selected language should update navigation, hero, About, event details, registration labels, buttons and contact content.

## 16. Design requirements
- Larger, readable fonts
- Mobile responsive
- Good visual hierarchy
- Religious/event-themed design without looking cluttered
- Full hero background image with translucent overlay
- Decorative elements in the About section
- Fixed WhatsApp button
- Clear Register/Participate call-to-action
- Good spacing on mobile and desktop

## 17. Admin security
- Admin panel must require login.
- Admin password must not be hard-coded into the public website.
- Use the `ADMIN_PASSWORD` server environment variable.
- Do not expose Cashfree secret keys in browser JavaScript.
- Logout button should be available.

## 18. Deployment
Target hosting: Railway.

The website needs:
- Node.js/Express server
- SQLite database for the current implementation
- Persistent storage for uploaded images/videos and database
- HTTPS
- Custom domain: `navachandiyagam.online`

Before production, ensure Railway persistent storage/volume is configured so registrations and uploaded media are not lost after a redeploy/restart.

## 19. Current public-facing details
Branding should primarily use:
- Tamil: நவசண்டி யாகம்
- English: Nava Chandi Yagam

Use the temple name in the venue/contact information as:
- Arulmigu Sri Mariamman Temple

Do not use “Sri Mahamariamman Temple” as the website's main branding.

## 20. Files
The admin HTML file supplied with this specification is the current admin-panel interface. It is intended to work with the Node.js backend/API; it is not a completely offline standalone admin system.

For deployment, keep the admin HTML and public website inside the Node.js project's `public` directory and keep server-side payment/database logic in `server.js`.
