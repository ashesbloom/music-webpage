const music = new Audio("playback_tree/songs/joji/nector/5.mp3");
// music.play();

const songs = [
    {
        id: 1,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        songName: `Ew`,
        artist: `Joji`,
        time: '03:27'

    },
    {
        id:2,
        songName: `Modus`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:27',
        artist: `Joji`,
    },
    {
        id:3,
        songName: `Tick Tock`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:12',
        artist: `Joji`,
    },
    {
        id:4,
        songName: `Daylight`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:43',
        artist: `Joji`,
    },
    {
        id:5,
        songName: `Gimme Love`,
        poster: "playback_tree/covers/joji/joji_golden.jpg",
        time:'01:29',
        artist: `Joji`,
    },
    {
        id:6,
        songName: `Run`,
        poster: `playback_tree/covers/joji/joji_run.jpg`,
        time:'03:34',
        artist: `Joji`,
    },
    {
        id:7,
        songName: `Santuary`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:15',
        artist: `Joji`,
    },
    {
        id:8,
        songName: `High Hopes`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:02',
        artist: `Joji`,
    },
    {
        id:9,
        songName: `Nitrous`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:11',
        artist: `Joji`,
    },
    {
        id:10,
        songName: `Pretty Boy`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:36',
        artist: `Joji`,
    },
    {
        id:11,
        songName: `Normal People`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:46',
        artist: `Joji`,
    },
    {
        id:12,
        songName: `Afterthought`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:46',
        artist: `Joji`,
    },
    {
        id:13,
        songName: `Mr.Hollywood`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:14',
        artist: `Joji`,
    },
    {
        id:14,
        songName: `777`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:22',
        artist: `Joji`,
    },
    {
        id:15,
        songName: `Reanimator`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:01',
        artist: `Joji`,
    },
    {
        id:16,
        songName: `Like You Do`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'03:03',
        artist: `Joji`,
    },
    {
        id:17,
        songName: `Your Man`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'04:00',
        artist: `Joji`,
    },
    {
        id:18,
        songName: `Upgrade`,
        poster: "playback_tree/covers/joji/joji_nector.jpg",
        time:'02:43',
        artist: `Joji`,
    },
]


// Array.from(document.querySelectorAll('.song_list .song_items')).forEach((e,i) =>{
//     e.querySelector('img')[0].src = songs[i].poster;
// })
document.addEventListener('DOMContentLoaded', function() {
    const songItems = document.querySelectorAll('.songs_list .song_items');

    songItems.forEach((item, index) => {
        const img = item.querySelector('img');
        img.src = songs[index].poster;
        const na = item.querySelector('h5');
        na.innerHTML = songs[index].songName;
        const da = item.querySelector('.duration h5');
        da.innerHTML = songs[index].time;
    });
});
document.addEventListener('DOMContentLoaded', function () {
    let masterplay = document.getElementById('master_play');
    let playicon = document.getElementById('play');

    masterplay.addEventListener('click', () => {
        if (music.paused || music.currentTime <= 0) {
            music.play();
            playicon.className='fa-solid fa-pause';
        } else {
            music.pause();
            playicon.className='fa-solid fa-play';
        }
    });
});

let index= 0;

document.addEventListener('DOMContentLoaded', function () {
    const idcollector = document.querySelectorAll('.songs_list .song_items');
    let playicon = document.getElementById('play');
    let covericon = document.getElementById('main_cover');
    let title = document.getElementById('albumtext');
    let description = document.getElementById('albumdescription')
    idcollector.forEach((e) => {
        e.addEventListener('click', () => {
            index = e.id;
                // console.log(index);
            music.src = `playback_tree/songs/joji/nector/${index}.mp3`;
            music.play()
            playicon.className='fa-solid fa-pause';
            index = parseInt(index) - 1;
            covericon.src= songs[index].poster;
            title.innerHTML = songs[index].songName;
            description.innerHTML = songs[index].artist;
        })
    })
});

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
    let currentValue = document.getElementById("v_bar").value;
    rangeSlider(currentValue);
}, 100);
