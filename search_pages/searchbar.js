document.addEventListener('DOMContentLoaded', function () {
    let availableKeywords = [
      'Glimpse of Us',
      'Feeling Like the End',
      'Die For You',
      'Before the Day is Over',
      'Dissolve',
      'Night Rider',
      'BlahBlahBlah',
      'Yukon',
      '1Am freestyle'
    ];
  
    const resultbox = document.querySelector(".resultbox");
    const inputbox = document.getElementById("inputbox");
  
    inputbox.addEventListener("input", function () {
      let input = inputbox.value.toLowerCase();
      let result = availableKeywords.filter(keyword => keyword.toLowerCase().includes(input));
      display(result);
    });
  
    const songImageMapping = {
      'Ew': 'playback_tree/covers/joji/joji_nector.jpg',
      'feeling_like_the_end': 'playback_tree/covers/joji/joji_feeling_like_the_end.jpg',
      'die_for_you': 'playback_tree/covers/joji/joji_feeling_like_the_end.jpg',
      'before_the_day_is_over': 'playback_tree/covers/joji/feeling_like_the_end.jpg',
      'dissolve': 'playback_tree/covers/joji/feeling_like_the_end.jpg',
      'night_rider': 'playback_tree/covers/joji/feeling_like_the_end.jpg',
      'blahblahblah': 'playback_tree/covers/joji/feeling_like_the_end.jpg',
      'yukon': 'playback_tree/covers/joji/feeling_like_the_end.jpg',
      '1am_freestyle': 'playback_tree/covers/joji/feeling_like_the_end.jpg'
      // Add more entries as needed
    };
  
    function display(result) {
      const content = result.map((list) => {
        const imageName = list.replace(/\s+/g, '_').toLowerCase();
        const imagePath = songImageMapping[imageName];
        const fileName = list.replace(/\s+/g, '_').toLowerCase() + '.html';
  
  
  
        return `<li><img src="${imagePath}" alt="${list}" style="width: 30px; height:30px; margin-right:10px;> <a href="${fileName}">${list}</a> </li>`;
      });
  
      resultbox.innerHTML = `<ul>${content.join('')}</ul>`;
      resultbox.style.display = result.length > 0 ? 'block' : 'none';
    }
  
    function calculateImageSize(songName) {
      // Adjust the base size and factor based on your preference
      const baseSize = 30;
      const sizeFactor = 2;
      return baseSize + sizeFactor * songName.length;
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