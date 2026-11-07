# London data providers

Agent Meet has two explicit data modes. `DATA_MODE=fixture` is the local default and uses synthetic travel times, origins and fictional restaurants. The interface must keep its example-data label visible. `DATA_MODE=live` uses the services below and reports their failures. A live request never falls back to example data. A dinner retains the data mode in which it was created, and the adapters reject planning when that mode differs from the running app.

## Location lookup

Full postcodes use [Postcodes.io](https://postcodes.io/docs/overview/). It is a public UK postcode API with no authentication requirement. The adapter requires a London-region result within its London geographic bounds. It rejects missing, invalid, terminated or non-London results. Coordinates are postcode centroids, which are approximate starting points rather than precise street addresses. Postcodes.io publishes its source-data licences separately in its [licence documentation](https://postcodes.io/docs/licenses).

Station names use Transport for London's [Unified API](https://api.tfl.gov.uk/swagger/docs/v1). The service resolves the pilot's eight named candidate stations by their TfL identifiers, including exact child stops when the API wraps them in a parent interchange hub. It uses the requested stop's coordinates rather than substituting the hub centroid. For other origins, a station search must produce an exact normalized station-name match. Partial matches are returned as a request for a more specific name. This avoids silently choosing a similarly named station.

`TFL_APP_KEY` is optional at runtime. An authorised deployment should register with TfL and configure a key if required by its access tier. No account or paid resources are created by this adapter. Transport for London's [open-data information](https://tfl.gov.uk/info-for/open-data-users/) describes access and licence requirements. Show Transport for London as the travel-data source.

## Timed public transport

The adapter compares a bounded pilot set around King's Cross, Bank, London Bridge, Liverpool Street, Waterloo, Victoria, Stratford and Paddington. This is not an exhaustive optimization across all London destinations. In live mode, the station coordinates are fetched from TfL rather than treating the fixture coordinates as current data.

For every included attending guest, the adapter asks TfL for an outward trip arriving by dinner start and a return trip departing after dinner end. The selected UTC instants are formatted in Europe/London for the API's date and time arguments, including British Summer Time and overnight returns. It uses public modes validated through TfL's `/Journey/Meta/Modes` endpoint, including bus, national rail, Tube, DLR, Overground, Elizabeth line, tram and walking. No personal starting-point label is returned with the shared area result.

Ranking first minimizes the maximum single-direction journey across the group. Equal maxima are ordered by spread of each guest's worst journey, combined travel minutes, then stable area identifier. A genuinely empty route result excludes an area. A timeout, invalid body, authentication problem or other provider failure stops the ranking with an error, so unreliable coverage cannot make another area appear unfairly better.

The pilot imposes a maximum of 24 attending guests and a 30-day forward horizon. That horizon is an application limit, not a promise that TfL can plan every date inside it. TfL may have a shorter available timetable horizon or route-specific limitations. Those failures are shown as unavailable. Timetable estimates are not live guarantees of service or disruption-free travel. Guests arrange the final station-to-venue leg themselves.

## Restaurant candidates

Restaurant lookup uses [OpenStreetMap data through Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API). It queries at most 60 mapped restaurants within 750 metres of an area station and returns up to five non-conflicting candidates. Restaurant names, addresses, cuisine and dietary tags come from that response. Every result links to the mapped place so the organiser can check its evidence.

The V1 organiser manually verifies the restaurant. OpenStreetMap often lacks price and complete dietary information. The adapter reports price as **unknown**, preserves published opening-hours text for manual checking, and labels missing dietary facts as **unknown**. It does not establish moderate pricing, table availability, opening on the dinner date or allergen safety. A venue with a known conflicting dietary tag is excluded. Unknown tags are candidates requiring verification, not verified dietary matches. Other free-text food requirements always require a venue check.

Known cuisine tags are mapped into the guest-facing categories. A guest's **No thanks** excludes a tagged cuisine. Otherwise the list is ordered by the number of guests who **Prefer** its cuisines, then those **Happy with** them. Each guest counts at most once at their strongest matching level. Missing tags are neutral. If no non-conflicting mapped venues exist, the adapter returns an empty list and the organiser can use the manual venue flow. Selecting an area only establishes that it has mapped candidates worth checking.

The station shown with a restaurant is explicitly its **area station**. The adapter does not claim it is the nearest station to the venue. Venue addresses can be incomplete in OSM and must be completed by the organiser before final confirmation.

### Attribution and retention

Show **© OpenStreetMap contributors · ODbL** beside live restaurant results and link it to [OpenStreetMap's copyright and licence page](https://www.openstreetmap.org/copyright). Preserve the source links when data is stored with a dinner. OSM data is available under the Open Database License, and redistribution of derived datasets must follow its terms. This data licence is separate from the application's source-code licence. No map tiles, photographs or reviews are downloaded.

The public Overpass service is shared infrastructure without an application SLA. Successful raw station-area restaurant responses are cached for 15 minutes within each server process, capped at 32 entries; concurrent identical searches in that process share one request. Failed or incomplete responses are not cached. Cuisine and diet filters are reapplied separately for every dinner, so one group's preferences cannot affect another group's results. Guest origins, journey requests, names and replies never enter this shared cache. The cache is an optimisation, not a persistent or cross-instance availability guarantee; a cold Vercel instance still needs the service. Keep this deployment at pilot traffic and review the instance's [usage guidance](https://wiki.openstreetmap.org/wiki/Overpass_API) before expanding. No key or billing setup is required for the selected public endpoint. It can throttle, time out or be unavailable.

Google Places is deliberately not part of the implemented adapter. Its selected fields can incur charges, and its [attribution and storage restrictions](https://developers.google.com/maps/documentation/places/web-service/policies) would need a different persistence and presentation design. The unused Google API key is not required.

## Request bounds and private information

Requests use only fixed service origins, explicit numeric geographic coordinates or encoded station/postcode input. The adapter never fetches a user-submitted website. It follows no redirects, bounds response accumulation to 2 MB while streaming (including missing or misleading Content-Length), retries at most once on rate limits or server errors and uses per-request timeouts within a total 25-second operation budget. At most four service calls run concurrently. Provider error messages presented to users are generic and never contain keys, raw URLs or private origin input.

The public Postcodes.io and TfL services receive the starting location necessary to compute a journey. OpenStreetMap receives only the candidate area coordinates. None of them receive guest names, emails or dietary free text. Source labels and journey minutes appear in shared results, while starting locations stay out of that payload.

## Verification

`pnpm exec tsx --test tests/providers.test.ts` checks deterministic fixture operation, location validation, winter/summer and overnight date formatting, worst-journey fairness, cuisine preferences and vetoes, dietary contradictions, unknown facts, malformed data, throttling, provider failure versus unavailable route, the forward-date guard and fixture/live separation. Tests inject a fake network and make no live requests.

During implementation on 7 November 2026, read-only live smoke checks succeeded for a London postcode lookup (`SW1A 1AA`), TfL station-name lookup, all eight candidate station identifiers, the journey-mode list and a dated arriving journey. These checks used public location examples, no guest data and no paid API. The public Overpass sample did not complete reliably inside the request timeout. A final small public-coordinate probe received HTTP 406 from the selected `overpass-api.de` endpoint and HTTP 429 from the alternative `overpass.private.coffee` endpoint; neither established a usable restaurant response. The alternative was not added as an automatic fallback on that evidence. Live restaurant coverage and a complete live-data dinner still need to be verified before claiming live readiness. Fixture tests do not establish live coverage.

For repeatable smoke testing, configure `DATA_MODE=live`, use a current future date within the service's supported timetable, and keep the batch small. Test returned source labels, one outward trip and its timed return, an eligible mapped restaurant, an unknown field, a no-route case and a provider-failure case separately. Record results without printing credentials or real participant information.

`pnpm providers:smoke --live` performs one public London postcode lookup without needing a database. Add `--full` to check a synthetic single-guest dinner seven days ahead, including outward/return routing and the restaurant adapter. Full mode queries the bounded pilot station set; it is an operator check, not a health endpoint to poll. Output contains stage/status/counts and generic error codes, never keys, raw request URLs or participant details. The script requires explicit `--live`, never sends emails, and never writes a dinner. An OSM candidate result still requires manual price, opening-time and dietary verification; it does not satisfy the V2 venue-evidence gate.
