const volumeBar = document.getElementById("v_bar");
const muteButton = document.getElementById("mute_button");

function rangeSlider(value) {
    document.getElementById("v_num").textContent = value;
    let volumeIcon = document.getElementById('volume_icon');
    if (music.muted || Number(value) === 0) {
        volumeIcon.className = 'icon icon-volume-mute';
    } else if (Number(value) < 50) {
        volumeIcon.className = 'icon icon-volume-low';
    } else {
        volumeIcon.className = 'icon icon-volume-high';
    }
    music.volume = value / 100;

    // Store the volume value in localStorage
    localStorage.setItem('savedVolume', value);
}

// Restore the saved volume (or apply the slider's default) on load
let savedVolume = localStorage.getItem('savedVolume');
if (savedVolume !== null) {
    volumeBar.value = savedVolume;
}
rangeSlider(volumeBar.value);

volumeBar.addEventListener("input", function () {
    rangeSlider(this.value);
});

muteButton.addEventListener("click", function () {
    music.muted = !music.muted;
    this.setAttribute('aria-pressed', music.muted);
    rangeSlider(volumeBar.value);
});
