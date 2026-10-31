
/* =========================================
   WEATHER DASHBOARD
   15 Georgian cities + 500 world cities
   Open-Meteo + Leaflet + Canvas Weather Overlay
========================================= */

const WORLD_CITIES_URL =
    "https://huggingface.co/datasets/bamwor/world-cities/resolve/main/world_cities.csv";

const WEATHER_API =
    "https://api.open-meteo.com/v1/forecast";

const GEOCODING_API =
    "https://geocoding-api.open-meteo.com/v1/search";

const BATCH_SIZE = 50;

/* =========================================
   GEORGIA - 15 CITIES
========================================= */

const GEORGIA_CITIES = [
    { name: "Tbilisi", country: "Georgia", lat: 41.7151, lon: 44.8271 },
    { name: "Batumi", country: "Georgia", lat: 41.6168, lon: 41.6367 },
    { name: "Kutaisi", country: "Georgia", lat: 42.2679, lon: 42.6946 },
    { name: "Rustavi", country: "Georgia", lat: 41.5495, lon: 44.9932 },
    { name: "Gori", country: "Georgia", lat: 41.9842, lon: 44.1158 },
    { name: "Zugdidi", country: "Georgia", lat: 42.5088, lon: 41.8709 },
    { name: "Poti", country: "Georgia", lat: 42.1462, lon: 41.6719 },
    { name: "Khashuri", country: "Georgia", lat: 41.9941, lon: 43.5999 },
    { name: "Samtredia", country: "Georgia", lat: 42.1537, lon: 42.3352 },
    { name: "Senaki", country: "Georgia", lat: 42.2697, lon: 42.0676 },
    { name: "Zestafoni", country: "Georgia", lat: 42.1098, lon: 43.0367 },
    { name: "Telavi", country: "Georgia", lat: 41.9198, lon: 45.4732 },
    { name: "Akhaltsikhe", country: "Georgia", lat: 41.6390, lon: 42.9826 },
    { name: "Ozurgeti", country: "Georgia", lat: 41.9244, lon: 42.0068 },
    { name: "Marneuli", country: "Georgia", lat: 41.4759, lon: 44.8089 }
];

/* =========================================
   GLOBAL STATE
========================================= */

let cities = [];
let cityWeather = [];
let markerLayer;
let selectedMarker = null;

let currentMapMode = "temperature";
let overlayLayer = null;

let isLoading = false;

/* =========================================
   MAP INITIALIZATION
========================================= */

const map = L.map("map", {
    minZoom: 2,
    maxZoom: 12,
    zoomControl: true,
    worldCopyJump: false,
    maxBounds: [
        [-85, -180],
        [85, 180]
    ],
    maxBoundsViscosity: 1,
    preferCanvas: true
}).setView([25, 10], 2);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors",
        minZoom: 2,
        maxZoom: 19,
        noWrap: true,
        bounds: [
            [-85, -180],
            [85, 180]
        ]
    }
).addTo(map);

markerLayer = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 45,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true
});

map.addLayer(markerLayer);

/* =========================================
   DOM ELEMENTS
========================================= */

const cityCountElement =
    document.getElementById("cityCount");

const loadingElement =
    document.getElementById("mapLoading");

const loadingText =
    document.getElementById("loadingText");

const modeLabel =
    document.getElementById("currentModeLabel");

const legendTitle =
    document.getElementById("legendTitle");

const legendUnit =
    document.getElementById("legendUnit");

const legendGradient =
    document.getElementById("legendGradient");

const legendLabels =
    document.getElementById("legendLabels");

const legendDescription =
    document.getElementById("legendDescription");

/* =========================================
   LOADING DISPLAY
========================================= */

function showLoading(message) {
    loadingText.textContent = message;
    loadingElement.classList.remove("hidden");
}

function hideLoading() {
    loadingElement.classList.add("hidden");
}

/* =========================================
   CSV PARSER
========================================= */

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);

    if (lines.length < 2) {
        throw new Error("City dataset is empty.");
    }

    function parseLine(line) {
        const values = [];
        let current = "";
        let insideQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (insideQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === "," && !insideQuotes) {
                values.push(current);
                current = "";
            } else {
                current += char;
            }
        }

        values.push(current);
        return values;
    }

    const headers = parseLine(lines[0]).map(h => h.trim());

    return lines.slice(1).map(line => {
        const values = parseLine(line);
        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index] ?? "";
        });

        return row;
    });
}

/* =========================================
   LOAD WORLD CITY DATASET
========================================= */

async function loadWorldCities() {
    showLoading("Loading worldwide city database...");

    const response = await fetch(WORLD_CITIES_URL);

    if (!response.ok) {
        throw new Error("Could not load world city database.");
    }

    const csvText = await response.text();
    const records = parseCSV(csvText);

    const internationalCities = records
        .filter(city => city.country_code !== "GE")
        .map(city => ({
            name: city.name,
            country: city.country_code,
            lat: Number(city.latitude),
            lon: Number(city.longitude),
            population: Number(city.population) || 0
        }))
        .filter(city =>
            city.name &&
            Number.isFinite(city.lat) &&
            Number.isFinite(city.lon) &&
            Math.abs(city.lat) <= 85 &&
            Math.abs(city.lon) <= 180
        )
        .sort((a, b) => b.population - a.population)
        .slice(0, 500);

    if (internationalCities.length < 500) {
        throw new Error(
            `Only ${internationalCities.length} international cities were loaded.`
        );
    }

    cities = [
        ...GEORGIA_CITIES,
        ...internationalCities
    ];

    cityCountElement.textContent = `0 / ${cities.length}`;

    return cities;
}

/* =========================================
   WEATHER API
========================================= */

async function fetchWeatherBatch(batch) {
    const latitudes = batch.map(city => city.lat).join(",");
    const longitudes = batch.map(city => city.lon).join(",");

    const url =
        `${WEATHER_API}?latitude=${latitudes}` +
        `&longitude=${longitudes}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code` +
        `&timezone=auto`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Weather API request failed.");
    }

    const data = await response.json();

    return Array.isArray(data) ? data : [data];
}

/* =========================================
   LOAD WEATHER FOR ALL 515 CITIES
========================================= */

async function loadAllWeather() {
    cityWeather = new Array(cities.length).fill(null);

    let completed = 0;

    for (let start = 0; start < cities.length; start += BATCH_SIZE) {
        const batch = cities.slice(start, start + BATCH_SIZE);

        showLoading(
            `Loading weather data... ${completed} / ${cities.length}`
        );

        try {
            const results = await fetchWeatherBatch(batch);

            results.forEach((result, index) => {
                const cityIndex = start + index;

                if (result && result.current) {
                    cityWeather[cityIndex] = {
                        temperature: result.current.temperature_2m,
                        humidity: result.current.relative_humidity_2m,
                        wind: result.current.wind_speed_10m,
                        feelsLike: result.current.apparent_temperature,
                        weatherCode: result.current.weather_code
                    };
                }
            });

        } catch (error) {
            console.error(
                `Weather batch failed at city ${start}:`,
                error
            );
        }

        completed = Math.min(start + batch.length, cities.length);

        cityCountElement.textContent =
            `${completed} / ${cities.length}`;
    }

    cityCountElement.textContent =
        `${cityWeather.filter(Boolean).length} / ${cities.length}`;

    renderCityMarkers();
    drawWeatherOverlay();
}

/* =========================================
   CITY MARKERS
   Marker design stays the same in all modes.
========================================= */

function createCityIcon() {
    return L.divIcon({
        className: "city-marker-icon",
        html: `<div class="city-marker-dot"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

function renderCityMarkers() {
    markerLayer.clearLayers();

    cities.forEach((city, index) => {
        const weather = cityWeather[index];

        if (!weather) return;

        const marker = L.marker(
            [city.lat, city.lon],
            {
                icon: createCityIcon(),
                title: `${city.name}, ${city.country}`
            }
        );

        marker.bindTooltip(
            `${city.name}, ${city.country}`,
            {
                direction: "top",
                offset: [0, -8]
            }
        );

        marker.bindPopup(`
            <div class="city-popup">
                <h3>${escapeHTML(city.name)}</h3>
                <p><strong>Country:</strong> ${escapeHTML(city.country)}</p>
                <p>🌡️ Temperature: ${weather.temperature ?? "--"} °C</p>
                <p>💧 Humidity: ${weather.humidity ?? "--"} %</p>
                <p>🌬️ Wind: ${weather.wind ?? "--"} km/h</p>
            </div>
        `);

        marker.on("click", () => {
            showCityWeather(city, weather);
        });

        markerLayer.addLayer(marker);
    });
}

/* =========================================
   SAFE HTML TEXT
========================================= */

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

/* =========================================
   WEATHER DETAILS CARD
========================================= */

function showCityWeather(city, weather) {
    if (!weather) return;

    document.getElementById("selectedCity").textContent =
        `${city.name}, ${city.country}`;

    document.getElementById("temperature").textContent =
        `${weather.temperature ?? "--"}°C`;

    document.getElementById("humidity").textContent =
        `${weather.humidity ?? "--"}%`;

    document.getElementById("windSpeed").textContent =
        `${weather.wind ?? "--"} km/h`;

    document.getElementById("feelsLike").textContent =
        `${weather.feelsLike ?? "--"}°C`;

    document.getElementById("weatherIcon").textContent =
        getWeatherIcon(weather.weatherCode);

    document.getElementById("weatherDescription").textContent =
        getWeatherDescription(weather.weatherCode);
}

/* =========================================
   WEATHER DESCRIPTIONS
========================================= */

function getWeatherDescription(code) {
    const descriptions = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        95: "Thunderstorm",
        96: "Thunderstorm with hail",
        99: "Heavy thunderstorm with hail"
    };

    return descriptions[code] || "Weather information available";
}

function getWeatherIcon(code) {
    if (code === 0) return "☀️";
    if ([1, 2].includes(code)) return "🌤️";
    if (code === 3) return "☁️";
    if ([45, 48].includes(code)) return "🌫️";
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "🌧️";
    if ([71, 73, 75].includes(code)) return "❄️";
    if ([95, 96, 99].includes(code)) return "⛈️";

    return "🌤️";
}

/* =========================================
   COLOR SYSTEM
========================================= */

const COLOR_STOPS = {
    temperature: [
        { value: -15, color: [37, 99, 235] },
        { value: 0, color: [6, 182, 212] },
        { value: 15, color: [34, 197, 94] },
        { value: 25, color: [234, 179, 8] },
        { value: 35, color: [249, 115, 22] },
        { value: 45, color: [220, 38, 38] }
    ],

    humidity: [
        { value: 0, color: [245, 158, 11] },
        { value: 25, color: [234, 179, 8] },
        { value: 45, color: [34, 197, 94] },
        { value: 65, color: [6, 182, 212] },
        { value: 85, color: [37, 99, 235] },
        { value: 100, color: [109, 40, 217] }
    ],

    wind: [
        { value: 0, color: [34, 197, 94] },
        { value: 10, color: [132, 204, 22] },
        { value: 20, color: [234, 179, 8] },
        { value: 35, color: [249, 115, 22] },
        { value: 50, color: [220, 38, 38] },
        { value: 80, color: [126, 34, 206] }
    ]
};

function getWeatherValue(weather, mode) {
    if (!weather) return null;

    if (mode === "temperature") return weather.temperature;
    if (mode === "humidity") return weather.humidity;
    if (mode === "wind") return weather.wind;

    return null;
}

function getInterpolatedColor(value, mode) {
    const stops = COLOR_STOPS[mode];

    if (!Number.isFinite(value)) {
        return [0, 0, 0];
    }

    if (value <= stops[0].value) {
        return stops[0].color;
    }

    if (value >= stops[stops.length - 1].value) {
        return stops[stops.length - 1].color;
    }

    for (let i = 0; i < stops.length - 1; i++) {
        const first = stops[i];
        const second = stops[i + 1];

        if (value >= first.value && value <= second.value) {
            const ratio =
                (value - first.value) /
                (second.value - first.value);

            return first.color.map((channel, index) =>
                Math.round(
                    channel +
                    (second.color[index] - channel) * ratio
                )
            );
        }
    }

    return [56, 189, 248];
}

/* =========================================
   CANVAS WEATHER OVERLAY
   Draws a continuous estimated weather field
   over the map, not over the city labels.
========================================= */

const WeatherOverlay = L.Layer.extend({

    onAdd: function (leafletMap) {
        this._map = leafletMap;

        this._canvas = document.createElement("canvas");
        this._canvas.className = "weather-overlay-canvas";

        this._context = this._canvas.getContext("2d");

        leafletMap.getPanes().overlayPane.appendChild(this._canvas);

        this._resizeHandler = () => this.redraw();

        leafletMap.on(
            "moveend zoomend resize",
            this._resizeHandler
        );

        this.redraw();
    },

    onRemove: function (leafletMap) {
        leafletMap.off(
            "moveend zoomend resize",
            this._resizeHandler
        );

        if (this._canvas && this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas);
        }
    },

    redraw: function () {
        if (!this._map || !this._canvas) return;

        const size = this._map.getSize();

        const scale = 0.38;
        const width = Math.max(1, Math.ceil(size.x * scale));
        const height = Math.max(1, Math.ceil(size.y * scale));

        this._canvas.width = width;
        this._canvas.height = height;

        this._canvas.style.width = `${size.x}px`;
        this._canvas.style.height = `${size.y}px`;

        const topLeft =
            this._map.containerPointToLayerPoint([0, 0]);

        L.DomUtil.setPosition(this._canvas, topLeft);

        const points = [];

        cities.forEach((city, index) => {
            const weather = cityWeather[index];
            const value = getWeatherValue(weather, currentMapMode);

            if (!Number.isFinite(value)) return;

            const point = this._map.latLngToLayerPoint([
                city.lat,
                city.lon
            ]);

            points.push({
                x: point.x - topLeft.x,
                y: point.y - topLeft.y,
                value
            });
        });

        if (points.length === 0) {
            this._context.clearRect(0, 0, width, height);
            return;
        }

        const ctx = this._context;
        ctx.clearRect(0, 0, width, height);

        const image = ctx.createImageData(width, height);
        const pixels = image.data;

        const step = 3;
        const maxDistance = 210;
        const maxDistanceSquared = maxDistance * maxDistance;

        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {

                const mapX = x / scale;
                const mapY = y / scale;

                let nearest = [];

                for (const point of points) {
                    const dx = point.x - mapX;
                    const dy = point.y - mapY;
                    const distanceSquared = dx * dx + dy * dy;

                    if (distanceSquared > maxDistanceSquared) {
                        continue;
                    }

                    nearest.push({
                        value: point.value,
                        distanceSquared
                    });
                }

                if (nearest.length === 0) continue;

                nearest.sort((a, b) =>
                    a.distanceSquared - b.distanceSquared
                );

                nearest = nearest.slice(0, 5);

                let weightedValue = 0;
                let totalWeight = 0;

                nearest.forEach(point => {
                    const weight =
                        1 / Math.pow(point.distanceSquared + 100, 1.15);

                    weightedValue += point.value * weight;
                    totalWeight += weight;
                });

                const value = weightedValue / totalWeight;

                const closestDistance =
                    Math.sqrt(nearest[0].distanceSquared);

                const distanceOpacity = Math.max(
                    0,
                    1 - closestDistance / maxDistance
                );

                const color = getInterpolatedColor(
                    value,
                    currentMapMode
                );

                const alpha = Math.round(
                    145 * Math.pow(distanceOpacity, 0.45)
                );

                for (let offsetY = 0; offsetY < step; offsetY++) {
                    for (let offsetX = 0; offsetX < step; offsetX++) {
                        const pixelX = x + offsetX;
                        const pixelY = y + offsetY;

                        if (pixelX >= width || pixelY >= height) {
                            continue;
                        }

                        const index =
                            (pixelY * width + pixelX) * 4;

                        pixels[index] = color[0];
                        pixels[index + 1] = color[1];
                        pixels[index + 2] = color[2];
                        pixels[index + 3] = alpha;
                    }
                }
            }
        }

        ctx.putImageData(image, 0, 0);
    }
});

/* =========================================
   CREATE OVERLAY
========================================= */

overlayLayer = new WeatherOverlay();
overlayLayer.addTo(map);

function drawWeatherOverlay() {
    if (overlayLayer) {
        overlayLayer.redraw();
    }
}

/* =========================================
   MAP MODE CONFIGURATION
========================================= */

const MODE_CONFIG = {
    temperature: {
        label: "Temperature",
        unit: "°C",
        title: "Temperature Distribution",
        gradient:
            "linear-gradient(90deg, #2563eb, #06b6d4, #22c55e, #eab308, #f97316, #dc2626)",
        labels: ["-15°C", "0°C", "15°C", "25°C", "35°C", "45°C"],
        description:
            "Blue indicates colder areas; red indicates hotter areas."
    },

    humidity: {
        label: "Humidity",
        unit: "%",
        title: "Relative Humidity",
        gradient:
            "linear-gradient(90deg, #f59e0b, #eab308, #22c55e, #06b6d4, #2563eb, #6d28d9)",
        labels: ["0%", "25%", "45%", "65%", "85%", "100%"],
        description:
            "Yellow indicates drier areas; blue and purple indicate higher humidity."
    },

    wind: {
        label: "Wind",
        unit: "km/h",
        title: "Wind Speed",
        gradient:
            "linear-gradient(90deg, #22c55e, #84cc16, #eab308, #f97316, #dc2626, #7e22ce)",
        labels: ["0", "10", "20", "35", "50", "80+ km/h"],
        description:
            "Green indicates light wind; red and purple indicate stronger wind."
    }
};

/* =========================================
   CHANGE MAP MODE
========================================= */

function setMapMode(mode) {
    if (!MODE_CONFIG[mode]) return;

    currentMapMode = mode;

    document.querySelectorAll(".mode-btn").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.mode === mode
        );
    });

    const config = MODE_CONFIG[mode];

    modeLabel.textContent = config.label;
    legendTitle.textContent = config.title;
    legendUnit.textContent = config.unit;
    legendGradient.style.background = config.gradient;
    legendDescription.textContent = config.description;

    legendLabels.innerHTML = config.labels
        .map(label => `<span>${label}</span>`)
        .join("");

    drawWeatherOverlay();
}

document.querySelectorAll(".mode-btn").forEach(button => {
    button.addEventListener("click", () => {
        setMapMode(button.dataset.mode);
    });
});

/* =========================================
   SEARCH CITY
========================================= */

async function searchCity() {
    const input = document
        .getElementById("citySearch")
        .value.trim();

    if (!input) return;

    const searchButton = document.getElementById("searchBtn");

    searchButton.disabled = true;
    searchButton.textContent = "Searching...";

    try {
        const url =
            `${GEOCODING_API}?name=${encodeURIComponent(input)}` +
            `&count=1&language=en&format=json`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Geocoding request failed.");
        }

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            alert("City not found. Try another name.");
            return;
        }

        const result = data.results[0];

        const city = {
            name: result.name,
            country: result.country || "Unknown",
            lat: result.latitude,
            lon: result.longitude
        };

        const weather = await fetchSingleWeather(
            city.lat,
            city.lon
        );

        if (!weather) {
            throw new Error("Weather information unavailable.");
        }

        map.setView([city.lat, city.lon], 7);

        showCityWeather(city, weather);

        if (selectedMarker) {
            map.removeLayer(selectedMarker);
        }

        selectedMarker = L.marker(
            [city.lat, city.lon],
            {
                icon: createCityIcon()
            }
        ).addTo(map);

        selectedMarker.bindPopup(`
            <div class="city-popup">
                <h3>${escapeHTML(city.name)}</h3>
                <p>${escapeHTML(city.country)}</p>
                <p>🌡️ ${weather.temperature}°C</p>
                <p>💧 ${weather.humidity}%</p>
                <p>🌬️ ${weather.wind} km/h</p>
            </div>
        `).openPopup();

    } catch (error) {
        console.error(error);
        alert("Could not search for this city. Please try again.");
    } finally {
        searchButton.disabled = false;
        searchButton.textContent = "Search";
    }
}

async function fetchSingleWeather(lat, lon) {
    const url =
        `${WEATHER_API}?latitude=${lat}` +
        `&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code` +
        `&timezone=auto`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Weather request failed.");
    }

    const data = await response.json();
    const current = data.current;

    if (!current) return null;

    return {
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        wind: current.wind_speed_10m,
        feelsLike: current.apparent_temperature,
        weatherCode: current.weather_code
    };
}

document
    .getElementById("searchBtn")
    .addEventListener("click", searchCity);

document
    .getElementById("citySearch")
    .addEventListener("keydown", event => {
        if (event.key === "Enter") {
            searchCity();
        }
    });

/* =========================================
   CLICK ANYWHERE ON MAP
========================================= */

map.on("click", async event => {
    try {
        const lat = event.latlng.lat;
        const lon = event.latlng.lng;

        const weather = await fetchSingleWeather(lat, lon);

        if (!weather) return;

        const city = {
            name: "Selected map location",
            country: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
            lat,
            lon
        };

        showCityWeather(city, weather);

        if (selectedMarker) {
            map.removeLayer(selectedMarker);
        }

        selectedMarker = L.marker(
            [lat, lon],
            {
                icon: createCityIcon()
            }
        ).addTo(map);

        selectedMarker.bindPopup(`
            <div class="city-popup">
                <h3>Selected location</h3>
                <p>🌡️ Temperature: ${weather.temperature}°C</p>
                <p>💧 Humidity: ${weather.humidity}%</p>
                <p>🌬️ Wind: ${weather.wind} km/h</p>
            </div>
        `).openPopup();

    } catch (error) {
        console.error("Map location weather error:", error);
    }
});

/* =========================================
   INITIALIZE APPLICATION
========================================= */

async function initializeDashboard() {
    if (isLoading) return;

    isLoading = true;

    try {
        await loadWorldCities();

        await loadAllWeather();

        setMapMode("temperature");

        const tbilisi = cities.find(
            city => city.name === "Tbilisi"
        );

        const tbilisiIndex = cities.findIndex(
            city => city.name === "Tbilisi"
        );

        if (tbilisi && cityWeather[tbilisiIndex]) {
            showCityWeather(
                tbilisi,
                cityWeather[tbilisiIndex]
            );
        }

        hideLoading();

    } catch (error) {
        console.error("Dashboard initialization failed:", error);

        loadingText.textContent =
            "Could not load data. Check your internet connection and refresh.";

    } finally {
        isLoading = false;
    }
}

initializeDashboard();
