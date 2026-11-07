# Coldplay-inspired GBK admission scenario

## Reference and proposed run

Use the public 15 November 2023 event as the admission reference. For the demo, propose **Saturday, 14 November 2026**, Asia/Jakarta, with **70,000 expected arrivals**. That date and demand are fictional. The scenario covers admission; venue configuration and capacity validation are pending. [Promoter reference](https://www.pk-ent.com/news/coldplay-music-of-the-spheres-world-tour)

Proposed clock is 09:00 arrival generation, 13:00 pre-function opening, 15:30 Ultimate check-in, 16:30 package experience, 17:00 premium concert doors, 17:30 general concert doors, 20:00 opening act, 21:00 main act, and 23:30 model end. The public guide supports the entry-time pattern. The demo date, arrival distribution and modeled processing are scenario inputs. [Published entry guide](https://www.antaranews.com/berita/3823839/perhatikan-hal-penting-ini-sebelum-nonton-konser-coldplay)

## Categories and volumes

The original sale had 11 ticket products. Their underlying viewing tiers are CAT 1–8 and Festival, with Ultimate Experience including CAT 1 and My Universe including Festival. Infinity is a later allocation scheme whose viewing location is assigned. For arrival modeling, the table uses 12 disjoint cohorts and reserves 500 for Infinity. Every count below is a fictional demo allocation. [Original ticket products](https://kalteng.antaranews.com/berita/634332/harga-tiket-konser-coldplay-di-jakarta-termahal-hingga-rp11-juta)

| Cohort | Expected people | Published entry area |
| --- | ---: | --- |
| Ultimate Experience | 800 | Plaza Tenggara |
| My Universe | 2,200 | Plaza Tenggara |
| CAT 1 | 6,000 | Plaza Tenggara |
| CAT 2 | 7,000 | Plaza Tenggara |
| Infinity allocation | 500 | Plaza Tenggara |
| CAT 3 | 8,000 | Plaza Barat |
| CAT 4 | 8,000 | Pintu Kuning / Gate H |
| CAT 5 | 5,000 | Plaza Utara |
| CAT 6 | 4,000 | Plaza Utara |
| CAT 7 | 3,000 | Plaza Utara |
| CAT 8 | 3,500 | Plaza Utara |
| Festival | 22,000 | Plaza Timur / Festival |
| **Total** | **70,000** | |

Those category-to-entry-area assignments follow the published guide. Totals by area are Tenggara 16,500, Barat 8,000, Kuning 8,000, Utara 15,500, and Timur 22,000. These are five shared admission areas. Keep event gate letters, GBK complex Pintu numbers, and inner stadium doors as separate IDs. Inner stadium door assignments need their own mapping. [Published category routing](https://amp.kompas.com/hype/read/2023/11/14/105246766/denah-venue-konser-coldplay-di-jakarta)

The 500 Infinity attendees are included once. The fixture proposes a fixed allocation across the nine viewing tiers for reproducibility, and keeps their arrival processing at Plaza Tenggara. Internal routes to the allocated viewing areas require validation.

## Wristbands and admission

The published instructions give attendees an admission wristband at entry using their e-ticket and matching ID. Security inspection and barcode scanning are part of admission. Groups with a shared purchase enter with the registered ticket holder. The available sources establish the admission functions; the temporary tent arrangement and physical order remain a scenario design. [Promoter instructions reported by Liputan6](https://www.liputan6.com/showbiz/read/5452689/h-1-konser-coldplay-di-jakarta-simak-informasi-penting-soal-e-ticket-dan-cara-masuk-venue-agar-tak-keliru) · [Wristband instructions](https://www.bloombergtechnoz.com/detail-news/20633/cara-tukar-wristband-untuk-masuk-venue-konser-coldplay-di-jakarta)

Model shared processing points at each admission area and a proposed staffed help-desk branch for exceptions. Ultimate Experience has a package check-in counter at Plaza Tenggara. Infinity has original-ID verification there. Individual category lanes can be added as explicit scenario assumptions. Evidence for separate redemption tent locations for every category was not found.

## Mapping to the scene

The JSON fixture stores five provisional anchors in the local metre frame. Their named admission-area assignment is sourced. Their exact positions are proposed markers for planning. They do not identify surveyed gate openings, safe waiting areas, or complete routes.

The scene's **Entry areas** toggle shows these anchors and fictional area totals. Keep this marker layer separate from transport arrival points, authored waypoints, processing checkpoints, and final seating destinations. [Scenario fixture](../data/scenarios/coldplay-gbk-demo.json) · [Coordinate contract](spatial-layout-contract.md)
