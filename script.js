// Function to geocode address to coordinates using Nominatim (free, no API key needed)
async function geocodeAddress(address) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                displayName: data[0].display_name
            };
        }
        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

// Function to fetch nearby recyclers/junk shops from Overpass API
async function fetchNearbyPlaces(lat, lng, radius = 10000) { // Radius in meters (10km default)
    const query = `
        [out:json][timeout:25];
        (
            node["amenity"="recycling"](around:${radius},${lat},${lng});
            node["shop"="scrap_yard"](around:${radius},${lat},${lng});
            way["amenity"="recycling"](around:${radius},${lat},${lng});
            way["shop"="scrap_yard"](around:${radius},${lat},${lng});
            relation["amenity"="recycling"](around:${radius},${lat},${lng});
            relation["shop"="scrap_yard"](around:${radius},${lat},${lng});
        );
        out center;
    `;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log('API Response:', data); // Debug log
        return data.elements.map(element => {
            const tags = element.tags || {};
            
            // Try multiple name sources
            let name = tags.name || 
                       tags['name:en'] || 
                       tags.operator || 
                       tags.brand || 
                       tags['operator:name'] || 
                       null;
            
            // Determine type
            const isRecycling = tags.amenity === 'recycling';
            const isJunkShop = tags.shop === 'scrap_yard';
            const type = isRecycling ? 'Recycling Center' : (isJunkShop ? 'Junk Shop' : 'Recycling Facility');
            
            // If no name found, create a descriptive name
            if (!name) {
                // Try to build name from address components
                const street = tags['addr:street'];
                const houseNumber = tags['addr:housenumber'];
                const city = tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'];
                
                if (street && houseNumber) {
                    name = `${type} - ${houseNumber} ${street}`;
                } else if (street) {
                    name = `${type} - ${street}`;
                } else if (city) {
                    name = `${type} - ${city}`;
                } else {
                    name = `${type}`;
                }
            }
            
            // Build better address from components
            const addressParts = [];
            if (tags['addr:housenumber']) addressParts.push(tags['addr:housenumber']);
            if (tags['addr:street']) addressParts.push(tags['addr:street']);
            if (tags['addr:city']) addressParts.push(tags['addr:city']);
            if (tags['addr:postcode']) addressParts.push(tags['addr:postcode']);
            if (tags['addr:state']) addressParts.push(tags['addr:state']);
            
            const fullAddress = addressParts.length > 0 
                ? addressParts.join(', ') 
                : (tags['addr:full'] || tags['addr:street'] || tags['addr:city'] || 
                   `${(element.lat || element.center?.lat)?.toFixed(4)}, ${(element.lon || element.center?.lon)?.toFixed(4)}`);
            
            return {
                name: name,
                lat: element.lat || element.center?.lat,
                lng: element.lon || element.center?.lon,
                address: fullAddress,
                materials: tags.recycling_type ? tags.recycling_type.split(';') : 
                          (tags.recycling ? [tags.recycling] : ['Various materials']),
                type: type
            };
        }).filter(place => place.lat && place.lng); // Filter valid entries
    } catch (error) {
        console.error('API fetch error:', error);
        return []; // Return empty array on error
    }
}

// Search by address input
document.getElementById('search').addEventListener('click', async () => {
    const locationInput = document.getElementById('location').value.trim();
    
    if (!locationInput) {
        alert('Please enter a location or use "Use My Location" button.');
        return;
    }
    
    const geocodeResult = await geocodeAddress(locationInput);
    
    if (!geocodeResult) {
        alert('Location not found. Please try a different address or city name.');
        return;
    }
    
    const places = await fetchNearbyPlaces(geocodeResult.lat, geocodeResult.lng);
    displayResults(geocodeResult.lat, geocodeResult.lng, places);
    initMap(geocodeResult.lat, geocodeResult.lng, places);
});

// Use current location
document.getElementById('use-location').addEventListener('click', async () => {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        async position => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            console.log('Geolocation success:', userLat, userLng);
            const places = await fetchNearbyPlaces(userLat, userLng);
            displayResults(userLat, userLng, places);
            initMap(userLat, userLng, places);
        },
        async error => {
            console.error('Geolocation error:', error);
            alert('Location access failed. Please allow location access or search by address.');
        }
    );
});

// Allow Enter key to trigger search
document.getElementById('location').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('search').click();
    }
});

function displayResults(lat, lng, places) {
    console.log('Displaying results:', places);
    const detailsContent = document.getElementById('details-content');
    detailsContent.innerHTML = '';
    
    if (places.length === 0) {
        detailsContent.innerHTML = '<p class="placeholder">No nearby places found. Try a different location.</p>';
        return;
    }
    
    // Sort by distance
    places.sort((a, b) => {
        const distA = calculateDistance(lat, lng, a.lat, a.lng);
        const distB = calculateDistance(lat, lng, b.lat, b.lng);
        return distA - distB;
    });
    
    places.forEach((place, index) => {
        const distance = calculateDistance(lat, lng, place.lat, place.lng);
        const detailItem = document.createElement('div');
        detailItem.className = 'detail-item';
        detailItem.innerHTML = `
            <h3>${place.name}</h3>
            ${place.type ? `<p class="type-badge">${place.type}</p>` : ''}
            <p><strong>Address:</strong> ${place.address}</p>
            <p><strong>Materials:</strong> ${place.materials.join(', ')}</p>
            <p class="distance">Distance: ${distance.toFixed(2)} km</p>
        `;
        detailsContent.appendChild(detailItem);
    });
}

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function initMap(lat, lng, places) {
    console.log('Initializing map with places:', places);
    const mapContainer = document.getElementById('map');
    
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }
    
    // Validate coordinates
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        console.error('Invalid coordinates:', lat, lng);
        mapContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: #7a8a7a;">Invalid location coordinates.</p>';
        return;
    }
    
    mapContainer.innerHTML = ''; // Clear previous map
    
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        console.error('Leaflet library not loaded');
        mapContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: #7a8a7a;">Map library is loading. Please wait...</p>';
        // Retry after a short delay
        setTimeout(() => {
            if (typeof L !== 'undefined') {
                initMap(lat, lng, places);
            } else {
                mapContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: #7a8a7a;">Map library failed to load. Please refresh the page.</p>';
            }
        }, 1000);
        return;
    }
    
    // Use Leaflet (OpenStreetMap) - No API key needed!
    try {
        // Ensure map container has dimensions
        if (mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
            console.warn('Map container has no dimensions, waiting...');
            setTimeout(() => initMap(lat, lng, places), 100);
            return;
        }
        
        const map = L.map(mapContainer, {
            zoomControl: true,
            attributionControl: true
        }).setView([lat, lng], 12);
        
        // Try multiple tile servers as fallback
        const tileServers = [
            {
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                attribution: '© OpenStreetMap contributors',
                name: 'OpenStreetMap'
            },
            {
                url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
                attribution: '© OpenStreetMap contributors, Tiles style by HOT',
                name: 'HOT'
            },
            {
                url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                attribution: '© OpenStreetMap contributors',
                name: 'OSM Direct'
            }
        ];
        
        let currentTileLayer = null;
        let tileLayerIndex = 0;
        let errorCount = 0;
        const MAX_TILE_ERRORS = 5; // Switch after 5 tile errors
        
        function addTileLayer(index) {
            if (index >= tileServers.length) {
                console.error('All tile servers failed');
                if (!currentTileLayer) {
                    mapContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: #7a8a7a;">Map tiles could not be loaded. Please check your internet connection and try again.</p>';
                }
                return;
            }
            
            const server = tileServers[index];
            
            // Remove previous tile layer if exists
            if (currentTileLayer) {
                map.removeLayer(currentTileLayer);
            }
            
            const tileLayer = L.tileLayer(server.url, {
                attribution: server.attribution,
                maxZoom: 19,
                crossOrigin: true
            });
            
            tileLayer.on('tileerror', function(error, tile) {
                errorCount++;
                console.warn(`Tile error ${errorCount}/${MAX_TILE_ERRORS} for ${server.name}`);
                
                // If too many errors, try next server
                if (errorCount >= MAX_TILE_ERRORS && index < tileServers.length - 1) {
                    console.log(`Switching to fallback tile server: ${tileServers[index + 1].name}`);
                    errorCount = 0;
                    addTileLayer(index + 1);
                }
            });
            
            tileLayer.on('tileload', function() {
                // Reset error count on successful tile load
                if (errorCount > 0) {
                    errorCount = Math.max(0, errorCount - 1);
                }
            });
            
            currentTileLayer = tileLayer;
            tileLayer.addTo(map);
            console.log('Using tile server:', server.name);
        }
        
        // Start with first tile server
        addTileLayer(0);
        
        // Add user location marker
        try {
            L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'user-location-marker',
                    html: '<div style="background-color: #2d5016; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            }).addTo(map).bindPopup('<strong>Your Location</strong>');
        } catch (markerError) {
            console.warn('Could not add user location marker:', markerError);
        }
        
        // Add markers for each recycler/junk shop
        places.forEach(place => {
            try {
                if (place.lat && place.lng && !isNaN(place.lat) && !isNaN(place.lng)) {
                    const marker = L.marker([place.lat, place.lng]).addTo(map);
                    const distance = calculateDistance(lat, lng, place.lat, place.lng);
                    marker.bindPopup(`
                        <div style="padding: 8px; min-width: 200px;">
                            <h3 style="margin: 0 0 8px 0; color: #2d5016; font-size: 16px;">${place.name}</h3>
                            ${place.type ? `<p style="margin: 4px 0; font-size: 12px; color: #4a7c59; font-weight: 500;">${place.type}</p>` : ''}
                            <p style="margin: 4px 0; font-size: 13px; color: #4a5a4a;">${place.address}</p>
                            <p style="margin: 4px 0; font-size: 13px;"><strong>Materials:</strong> ${place.materials.join(', ')}</p>
                            <p style="margin: 4px 0; font-size: 13px; color: #4a7c59;"><strong>Distance:</strong> ${distance.toFixed(2)} km</p>
                        </div>
                    `);
                }
            } catch (markerError) {
                console.warn('Could not add marker for place:', place.name, markerError);
            }
        });
        
        // Handle map errors
        map.on('tileerror', function(error, tile) {
            console.warn('Map tile error:', error);
        });
        
        console.log('Leaflet map initialized successfully');
    } catch (error) {
        console.error('Map initialization error:', error);
        mapContainer.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #7a8a7a;">
                <p>Map could not be loaded.</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Error: ${error.message || 'Unknown error'}</p>
                <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background-color: #4a7c59; color: white; border: none; border-radius: 4px; cursor: pointer;">Reload Page</button>
            </div>
        `;
    }
}