const music = new Audio("playback_tree/songs/joji/nector/");
// music.play();




function rangeSlider(value) {
    document.getElementById("v_num").innerHTML = value;
    let volumeIcon = document.getElementById('volume_icon');
    if (value === '0') {
        volumeIcon.className = 'fa-solid fa-volume-mute';
    }
    if (value < '50' && value !== '0') {
        volumeIcon.className = 'fa-solid fa-volume-low';
    }
    if (value > '50' || value === '100') {
        volumeIcon.className = 'fa-solid fa-volume-high';
    }
}

setInterval(function () {
    var currentValue = document.getElementById("v_bar").value;
    rangeSlider(currentValue);
}, 100);
