const music = new Audio("playback_tree/songs/joji/smithereens/21.mp3");
const songs =[
    {
        id:1,
        songName: `Feeling like the end`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'03:27',
        artist: `Joji`,

    },
    {
        id:'2r',
        poster: "playback_tree/covers/joji/joji_glimps_of_us.jpg",
        songName: `Glimpse of Us`,
        artist: `Joji`,
        time: '03:27'

    },
    {
        id:3,
        songName: `Die for you`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'02:12',
        artist: `Joji`,
    },
    {
        id:4,
        songName: `Before The Day is Over`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'02:43',
        artist: `Joji`,
    },
    {
        id:5,
        songName: `Dissolve`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'03:34',
        artist: `Joji`,
    },
    {
        id:6,
        songName: `Night Rider`,
        poster: `playback_tree/covers/joji/joji_smithereens.jpg`,
        time:'03:15',
        artist: `Joji`,
    },

    {
        id:7,
        songName: `BlahBlahBlah`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'03:00',
        artist: `Joji`,
    },
    {
        id:8,
        songName: `Youkon`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'03:02',
        artist: `Joji`,
    },
    {
        id:9,
        songName: `1AM Freestyle`,
        poster: "playback_tree/covers/joji/joji_smithereens.jpg",
        time:'02:11',
        artist: `Joji`,
    },
]

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
    let record = document.getElementById('record');
    masterplay.addEventListener('click', () => {
        if (music.paused || music.currentTime <= 0) {
            music.play();
            record.style.animation = `rotatei1 3.7s linear infinite`;
            playicon.className='fa-solid fa-pause';
        } else {
            music.pause();
            record.style.animation = `rotatei1 12s linear infinite`;
            playicon.className='fa-solid fa-play';
        }
    });
});

let index= 0;


document.addEventListener('DOMContentLoaded', function () {
    const idcollector = document.querySelectorAll('.song_items');
    let playicon = document.getElementById('play');
    let covericon = document.getElementById('main_cover');
    let playbackicon = document.getElementById('playback_cover');
    let title = document.getElementById('albumtext');
    let description = document.getElementById('albumdescription')
    let record = document.getElementById('record');
    idcollector.forEach((e) => {
        e.addEventListener('click', () => {
            index = e.id;
            // console.log(index);
            music.src = `playback_tree/songs/joji/smithereens/${index}.mp3`;
            music.play()
            record.style.animation = `rotatei1 3.7s linear infinite`;
            playicon.className='fa-solid fa-pause';
            index = parseInt(index) - 1;
            covericon.src= songs[index].poster;
            playbackicon.src= songs[index].poster;
            title.innerHTML = songs[index].songName;
            description.innerHTML = songs[index].artist;
        })
    })
});
document.addEventListener('DOMContentLoaded', function () {
    let currentstart=document.getElementById('current_time')
    let currentend=document.getElementById('end_time')
    let seek = document.getElementById('seek');
    let slider = document.getElementById('slider');
    let dot = document.getElementsByClassName('dot')[0];
    music.addEventListener('timeupdate', () => {
        let music_curr=music.currentTime;
        let music_du=music.duration;
        // console.log(music_curr);
        let min1 = Math.floor(music_du / 60);
        let sec1 = Math.floor(music_du % 60);
        // console.log(min1,':',sec1)
        let min2 = Math.floor(music_curr / 60);
        let sec2 = Math.floor(music_curr % 60);
        // console.log(min2,':',sec2)
        if (sec1 < 10) {
            sec1 = `0${sec1}`;
        }if (sec2 < 10) {
            sec2 = `0${sec2}`;
        }
        currentend.innerText = `/ ${min1}:${sec1}`;
        currentstart.innerText = `${min2}:${sec2} `;

        seek.value = parseInt((music_curr / music_du) * 100);
        let seekbar = seek.value;
        slider.style.width = `${seekbar}%`;
        dot.style.left = `${seekbar}%`;

    });
    seek.addEventListener('change', ()=>{
        music.currentTime = seek.value * music.duration / 100;
    })
});

document.addEventListener('DOMContentLoaded', function () {

    let back = document.getElementById('prev');
    let next = document.getElementById('next');
    let playicon = document.getElementById('play');
    let covericon = document.getElementById('main_cover');
    let playbackicon = document.getElementById('playback_cover');
    let title = document.getElementById('albumtext');
    let description = document.getElementById('albumdescription')
    let record = document.getElementById('record');

    back.addEventListener('click', ()=>{
        index += 1;
        index -= 1;

        if (index < 1){
            index=Array.from(document.querySelectorAll('.songs_list .song_items')).length;
        }
        music.src = `playback_tree/songs/joji/smithereens/${index}.mp3`;
        music.play();
        record.style.animation = `rotatei1 3.7s linear infinite`;
        playicon.className='fa-solid fa-pause';
        index = parseInt(index) - 1;
        covericon.src= songs[index].poster;
        playbackicon.src= songs[index].poster;
        title.innerHTML = songs[index].songName;
        description.innerHTML = songs[index].artist;
    })
    next.addEventListener('click', ()=>{
        index += 1;
        index = index + 1;
        if (index > Array.from(document.querySelectorAll('.songs_list .song_items')).length){
            index = 1;
        }
        music.src = `playback_tree/songs/joji/smithereens/${index}.mp3`;
        music.play();
        record.style.animation = `rotatei1 3.7s linear infinite`;
        playicon.className='fa-solid fa-pause';
        index = parseInt(index)-1;
        covericon.src= songs[index].poster;
        playbackicon.src= songs[index].poster;
        title.innerHTML = songs[index].songName;
        description.innerHTML = songs[index].artist;
    })
});
document.addEventListener('DOMContentLoaded', function () {
    music.addEventListener('ended', () => {
        let playicon = document.getElementById('play');
        let covericon = document.getElementById('main_cover');
        let playbackicon = document.getElementById('playback_cover');
        let title = document.getElementById('albumtext');
        let description = document.getElementById('albumdescription')
        let record = document.getElementById('record');
        let repeat = document.getElementById('repeat');
        let shuffle = document.getElementById('shuffle');

        if (repeat.classList.contains('clicked')) {
            setTimeout(function () {
                index += 1;
                index;
                music.src = `playback_tree/songs/joji/smithereens/${index}.mp3`;
                music.play();
                record.style.animation = `rotatei1 3.7s linear infinite`;
                playicon.className = 'fa-solid fa-pause';
                index = parseInt(index) - 1;
                covericon.src = songs[index].poster;
                playbackicon.src = songs[index].poster;
                title.innerHTML = songs[index].songName;
                description.innerHTML = songs[index].artist;
            }, 1000);
        }else if(shuffle.classList.contains('clicked')){
            setTimeout(function () {
                index += 1;
                // index = index + 1;
                if (index === songs.length) {
                    index = 1;
                } else {
                    index = Math.floor((Math.random() * songs.length) + 1);
                }
                music.src = `playback_tree/songs/joji/smithereens/${index}.mp3`;
                music.play();
                record.style.animation = `rotatei1 3.7s linear infinite`;
                playicon.className = 'fa-solid fa-pause';
                index = parseInt(index) - 1;
                covericon.src = songs[index].poster;
                playbackicon.src = songs[index].poster;
                title.innerHTML = songs[index].songName;
                description.innerHTML = songs[index].artist;
            }, 1000);
        } else {
            setTimeout(function () {
                index += 1;
                // index = index + 1;
                if (index === songs.length) {
                    index = 1;
                } else {
                    index = index + 1;
                }
                music.src = `playback_tree/songs/joji/smithereens/${index}.mp3`;
                music.play();
                record.style.animation = `rotatei1 3.7s linear infinite`;
                playicon.className = 'fa-solid fa-pause';
                index = parseInt(index) - 1;
                covericon.src = songs[index].poster;
                playbackicon.src = songs[index].poster;
                title.innerHTML = songs[index].songName;
                description.innerHTML = songs[index].artist;
            }, 1000);
        }
    })
});
document.addEventListener('DOMContentLoaded', function () {
    let availableKeywords = [
        'smithereens',
        'ew',
        'modus',
        'tick tock',
        'daylight',
        'gimme love',
        'run',

    ];

    const resultbox = document.querySelector(".resultbox");
    const inputbox = document.getElementById("inputbox");

    inputbox.addEventListener("input", function () {
        let input = inputbox.value.toLowerCase();
        let result = availableKeywords.filter(keyword => keyword.toLowerCase().includes(input));
        display(result);
    });

    const songImageMapping = {
        'Smithereens':'playback_tree/covers/joji/joji_smithereens.jpg',
        'Ew': 'playback_tree/covers/joji/joji_nector.jpg',
        'Modus': 'playback_tree/covers/joji/joji_nector.jpg',
        'Tick Tock': 'playback_tree/covers/joji/joji_nector.jpg',
        'Daylight': 'playback_tree/covers/joji/joji_daylight.jpg',
        'Gimme Love': 'playback_tree/covers/joji/joji_golden.jpg',
        'Run': 'playback_tree/covers/joji/joji_run.jpg',
        // Add more entries as needed
    };

    function display(result) {
        const content = result.map((list) => {
            const imageName = list.replace(/\s+/g, '_').toLowerCase();
            // const imagePath = songImageMapping[imageName];
            // const fileName = list + '.html';

            return `<li><img src="playback_tree/covers/joji/joji_smithereens.jpg" style="width: 30px; height:30px; margin-right:10px;"> <a href="Ew.html">${list}</a> </li>`;
        });

        // Assuming resultbox is a ul or ol element
        resultbox.innerHTML = content.join('');
        resultbox.innerHTML = `<ul>${content.join('')}</ul>`;
        resultbox.style.display = result.length > 0 ? 'block' : 'none';
    }
    document.addEventListener("click", function (event) {
        if (!resultbox.contains(event.target) && event.target !== inputbox) {
            resultbox.style.display = 'none';
        }
    });

    resultbox.addEventListener("click", function (event) {
        if (event.target.tagName === 'LI') {
            inputbox.value = event.target.textContent;
            resultbox.style.display = 'none';
        }
    });
});
function selectInput(element) {
    const imageName = element.id;
    console.log("selectInput function called");

    const pagePath = `${imageName}.html`;

    // Open the web page in the same tab
    window.open(pagePath, '_blank');
}