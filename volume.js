function rangeSlider(value) {
    document.getElementById("v_num").innerHTML = value;
    let volumeIcon = document.getElementById('volume_icon');
    if (value === '0') {
        volumeIcon.className = 'fa-solid fa-volume-mute';
    } else if (value < '50') {
        volumeIcon.className = 'fa-solid fa-volume-low';
    } else {
        volumeIcon.className = 'fa-solid fa-volume-high';
    }
    music.volume = value / 100;

    // Store the volume value in localStorage
    localStorage.setItem('savedVolume', value);
}

// Set interval to update volume slider
setInterval(function () {
    let currentValue = document.getElementById("v_bar").value;
    rangeSlider(currentValue);
}, 100);

// Check if there's a saved volume in localStorage and set it
document.addEventListener("DOMContentLoaded", function() {
    let savedVolume = localStorage.getItem('savedVolume');
    if (savedVolume !== null) {
        document.getElementById("v_bar").value = savedVolume;
        rangeSlider(savedVolume);
    }
});

// Event listener to save volume when it changes
document.getElementById("v_bar").addEventListener("input", function() {
    let currentValue = this.value;
    rangeSlider(currentValue);
    // Store the updated volume value in localStorage
    localStorage.setItem('savedVolume', currentValue);
});



