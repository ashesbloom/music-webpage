let vol_icon = document.getElementById('mute_button');
let vol = document.getElementById('v_bar');
// let vol_num= document.getElementById('v_num');
vol.addEventListener('change', () =>{
    if (vol.value === 0) {
        vol_icon.classList.add('fa-solid fa-volume-xmark');
        vol_icon.classList.remove('fa-solid fa-volume-low');
        vol_icon.classList.remove('fa-solid fa-volume-high');
    }
    if (vol.value > 0) {
        vol_icon.classList.remove('fa-solid fa-volume-xmark');
        vol_icon.classList.add('fa-solid fa-volume-low');
        vol_icon.classList.remove('fa-solid fa-volume-high');
    }
    if (vol.value > 50) {
        vol_icon.classList.remove('fa-solid fa-volume-xmark');
        vol_icon.classList.remove('fa-solid fa-volume-low');
        vol_icon.classList.add('fa-solid fa-volume-high');
    }
})