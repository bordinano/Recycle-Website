// Global map instance and markers
let currentMapInstance = null;
let currentMarkers = [];
let userLocationMarker = null;
let places = []; // Store places globally for address updates

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

// Function to reverse geocode coordinates to address using Nominatim (free, no API key needed)
async function reverseGeocode(lat, lng) {
    try {
        // Add a small delay to respect Nominatim's usage policy (1 request per second)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await response.json();
        
        if (data && data.address) {
            const addr = data.address;
            const addressParts = [];
            
            // Build address from components in logical order
            if (addr.house_number) addressParts.push(addr.house_number);
            if (addr.road) addressParts.push(addr.road);
            if (addr.neighbourhood || addr.suburb) addressParts.push(addr.neighbourhood || addr.suburb);
            if (addr.city || addr.town || addr.village) addressParts.push(addr.city || addr.town || addr.village);
            if (addr.postcode) addressParts.push(addr.postcode);
            if (addr.state) addressParts.push(addr.state);
            if (addr.country) addressParts.push(addr.country);
            
            return addressParts.length > 0 
                ? addressParts.join(', ') 
                : data.display_name || null;
        }
        return data.display_name || null;
    } catch (error) {
        console.error('Reverse geocoding error:', error);
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
            
            const lat = element.lat || element.center?.lat;
            const lng = element.lon || element.center?.lon;
            
            // Use address from tags if available, otherwise mark for reverse geocoding
            const addressFromTags = addressParts.length > 0 
                ? addressParts.join(', ') 
                : (tags['addr:full'] || tags['addr:street'] || tags['addr:city'] || null);
            
            return {
                name: name,
                lat: lat,
                lng: lng,
                address: addressFromTags, // Will be updated with reverse geocoding if null
                needsReverseGeocode: !addressFromTags, // Flag to indicate if we need to reverse geocode
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

// Use current location
document.getElementById('use-location').addEventListener('click', async () => {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }
    
    const loading = document.getElementById('loading');
    loading.classList.remove('hidden');
    
    navigator.geolocation.getCurrentPosition(
        async position => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            console.log('Geolocation success:', userLat, userLng);
            places = await fetchNearbyPlaces(userLat, userLng);
            
            // Display results immediately with available addresses
            displayResults(userLat, userLng, places);
            updateMap(userLat, userLng, places);
            loading.classList.add('hidden');
            
            // Reverse geocode addresses for places that need it (in background)
            const placesNeedingAddress = places.filter(p => p.needsReverseGeocode);
            if (placesNeedingAddress.length > 0) {
                // Show a subtle indicator that addresses are being fetched
                const detailsContent = document.getElementById('details-content');
                const indicator = document.createElement('div');
                indicator.id = 'address-loading-indicator';
                indicator.style.cssText = 'padding: 0.5rem; text-align: center; color: #4a7c59; font-size: 0.9rem; font-style: italic;';
                indicator.textContent = 'Fetching addresses...';
                detailsContent.appendChild(indicator);
                
                // Fetch addresses one by one (with delay to respect API limits)
                for (let i = 0; i < placesNeedingAddress.length; i++) {
                    const place = placesNeedingAddress[i];
                    const address = await reverseGeocode(place.lat, place.lng);
                    if (address) {
                        place.address = address;
                    } else {
                        // Fallback to coordinates if reverse geocoding fails
                        place.address = `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;
                    }
                    delete place.needsReverseGeocode;
                    
                    // Update the display with the new address
                    updateAddressInDisplay(place);
                }
                
                // Remove loading indicator
                const loadingIndicator = document.getElementById('address-loading-indicator');
                if (loadingIndicator) {
                    loadingIndicator.remove();
                }
            }
        },
        async error => {
            console.error('Geolocation error:', error);
            alert('Location access failed. Please allow location access.');
            loading.classList.add('hidden');
        }
    );
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
        detailItem.id = `place-${index}`;
        detailItem.dataset.placeIndex = index;
        
        // Show coordinates as placeholder if address is not available yet
        const displayAddress = place.address || `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;
        const addressLabel = place.address ? 'Address' : 'Location';
        
        detailItem.innerHTML = `
            <h3>${place.name}</h3>
            ${place.type ? `<p class="type-badge">${place.type}</p>` : ''}
            <p><strong>${addressLabel}:</strong> <span class="address-text">${displayAddress}</span></p>
            <p><strong>Materials:</strong> ${place.materials.join(', ')}</p>
            <p class="distance">Distance: ${distance.toFixed(2)} km</p>
        `;
        detailsContent.appendChild(detailItem);
    });
}

// Update address in the display when reverse geocoding completes
function updateAddressInDisplay(place) {
    const detailItems = document.querySelectorAll('.detail-item');
    detailItems.forEach(item => {
        const placeIndex = parseInt(item.dataset.placeIndex);
        if (places[placeIndex] === place) {
            const addressText = item.querySelector('.address-text');
            if (addressText) {
                addressText.textContent = place.address;
                // Update the label from "Location" to "Address"
                const addressLabel = item.querySelector('p strong');
                if (addressLabel && addressLabel.textContent.includes('Location:')) {
                    addressLabel.textContent = 'Address:';
                }
            }
        }
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

// Initialize map once on page load
function initializeMap() {
    const mapContainer = document.getElementById('map');
    
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }
    
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        console.error('Leaflet library not loaded');
        setTimeout(initializeMap, 500);
        return;
    }
    
    // Check if map already exists
    if (currentMapInstance) {
        return;
    }
    
    // Ensure map container has dimensions
    if (mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
        setTimeout(initializeMap, 100);
        return;
    }
    
    try {
        // Initialize map with a default center (world view)
        const map = L.map(mapContainer, {
            zoomControl: true,
            attributionControl: true
        }).setView([20, 0], 2); // World view
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            crossOrigin: true
        }).addTo(map);
        
        currentMapInstance = map;
        console.log('Map initialized');
    } catch (error) {
        console.error('Map initialization error:', error);
    }
}

// Update map with new location and places
function updateMap(lat, lng, places) {
    if (!currentMapInstance) {
        // If map not initialized, initialize it first
        initializeMap();
        // Wait a bit for map to initialize, then update
        setTimeout(() => updateMap(lat, lng, places), 500);
        return;
    }
    
    // Validate coordinates
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        console.error('Invalid coordinates:', lat, lng);
        return;
    }
    
    try {
        // Update map center and zoom
        currentMapInstance.setView([lat, lng], 12);
        
        // Remove old markers
        currentMarkers.forEach(marker => {
            currentMapInstance.removeLayer(marker);
        });
        currentMarkers = [];
        
        // Remove old user location marker
        if (userLocationMarker) {
            currentMapInstance.removeLayer(userLocationMarker);
            userLocationMarker = null;
        }
        
        // Add new user location marker
        userLocationMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'user-location-marker',
                html: '<div style="background-color: #2d5016; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(currentMapInstance).bindPopup('<strong>Your Location</strong>');
        
        // Add markers for each recycler/junk shop
        places.forEach(place => {
            try {
                if (place.lat && place.lng && !isNaN(place.lat) && !isNaN(place.lng)) {
                    const marker = L.marker([place.lat, place.lng]).addTo(currentMapInstance);
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
                    currentMarkers.push(marker);
                }
            } catch (markerError) {
                console.warn('Could not add marker for place:', place.name, markerError);
            }
        });
        
        console.log('Map updated with', places.length, 'places');
    } catch (error) {
        console.error('Map update error:', error);
    }
}

// Old initMap function - keeping for backward compatibility but it now just calls updateMap
function initMap(lat, lng, places) {
    updateMap(lat, lng, places);
}

// Initialize map when page loads
window.addEventListener('load', function() {
    initializeMap();
});